using System;
using System.Buffers.Binary;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EgoistShield.Service;

internal enum LocalServiceHealth { Responsive, Unresponsive, Unknown, ScmOnly, Conflict }

internal static class LocalServiceHealthProbe
{
    internal static async Task<LocalServiceHealth> TcpAsync(IPAddress address, int port, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            using var client = new TcpClient(address.AddressFamily);
            await client.ConnectAsync(address, port, deadline.Token);
            return LocalServiceHealth.Responsive;
        }
        catch (Exception error) when (error is SocketException or IOException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        { return LocalServiceHealth.Unresponsive; }
    }

    internal static async Task<LocalServiceHealth> DnsAsync(IPAddress address, int port, TimeSpan timeout, CancellationToken cancellationToken)
    {
        byte[] query = BuildDnsQuery();
        bool udpResponded = false;
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            deadline.CancelAfter(timeout);
            try
            {
                using var udp = new UdpClient(address.AddressFamily);
                udp.Connect(address, port);
                await udp.SendAsync(query, deadline.Token);
                while (true)
                {
                    var reply = await udp.ReceiveAsync(deadline.Token);
                    if (!IsDnsResponse(reply.Buffer, query)) continue;
                    udpResponded = true;
                    if ((reply.Buffer[2] & 2) == 0) return LocalServiceHealth.Responsive;
                    break; // A truncated UDP reply needs the DNS TCP transport.
                }
            }
            catch (Exception error) when (error is SocketException or IOException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested) { }
        }
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            deadline.CancelAfter(timeout);
            try
            {
                using var tcp = new TcpClient(address.AddressFamily);
                await tcp.ConnectAsync(address, port, deadline.Token);
                using var stream = tcp.GetStream();
                byte[] framed = new byte[query.Length + 2];
                BinaryPrimitives.WriteUInt16BigEndian(framed, (ushort)query.Length);
                query.CopyTo(framed, 2);
                await stream.WriteAsync(framed, deadline.Token);
                byte[] length = new byte[2];
                await stream.ReadExactlyAsync(length, deadline.Token);
                int size = BinaryPrimitives.ReadUInt16BigEndian(length);
                if (size >= 12 && size <= 4096)
                {
                    byte[] reply = new byte[size];
                    await stream.ReadExactlyAsync(reply, deadline.Token);
                    if (IsDnsResponse(reply, query)) return LocalServiceHealth.Responsive;
                }
            }
            catch (Exception error) when (error is SocketException or IOException || error is OperationCanceledException && !cancellationToken.IsCancellationRequested) { }
        }
        // Even a SERVFAIL/NXDOMAIN or valid truncated reply proves that the
        // local DNS event loop is alive. Provider reachability is a separate fact.
        return udpResponded ? LocalServiceHealth.Responsive : LocalServiceHealth.Unresponsive;
    }

    internal static byte[] BuildDnsQuery()
    {
        using var message = new MemoryStream();
        byte[] header = new byte[12];
        RandomNumberGenerator.Fill(header.AsSpan(0, 2));
        header[2] = 1; // RD
        header[5] = 1; // one question
        message.Write(header);
        foreach (string label in "health.egoist.invalid".Split('.'))
        {
            message.WriteByte((byte)label.Length);
            message.Write(Encoding.ASCII.GetBytes(label));
        }
        message.Write(new byte[] { 0, 0, 1, 0, 1 }); // A, IN
        return message.ToArray();
    }

    internal static bool IsDnsResponse(ReadOnlySpan<byte> reply, ReadOnlySpan<byte> query)
    {
        if (reply.Length < 12 || query.Length < 12 || reply[0] != query[0] || reply[1] != query[1] ||
            (reply[2] & 0xf8) != 0x80 || BinaryPrimitives.ReadUInt16BigEndian(reply.Slice(4, 2)) != 1)
            return false;
        int replyOffset = 12, queryOffset = 12;
        string? actual = ReadName(reply, ref replyOffset), expected = ReadName(query, ref queryOffset);
        return actual != null && string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase) &&
            replyOffset + 4 <= reply.Length && queryOffset + 4 <= query.Length &&
            reply.Slice(replyOffset, 4).SequenceEqual(query.Slice(queryOffset, 4));
    }

    private static string? ReadName(ReadOnlySpan<byte> message, ref int offset)
    {
        var name = new StringBuilder();
        int cursor = offset, end = -1;
        for (int steps = 0; steps < 128 && cursor < message.Length; steps++)
        {
            int size = message[cursor++];
            if (size == 0) { offset = end >= 0 ? end : cursor; return name.ToString(); }
            if ((size & 0xc0) == 0xc0)
            {
                if (cursor >= message.Length) return null;
                int pointer = ((size & 0x3f) << 8) | message[cursor++];
                if (pointer >= message.Length) return null;
                if (end < 0) end = cursor;
                cursor = pointer;
                continue;
            }
            if (size > 63 || cursor + size > message.Length || name.Length + size > 253) return null;
            if (name.Length > 0) name.Append('.');
            name.Append(Encoding.ASCII.GetString(message.Slice(cursor, size)));
            cursor += size;
        }
        return null;
    }
}
