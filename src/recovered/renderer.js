var e = Object.create, t = Object.defineProperty, n = Object.getOwnPropertyDescriptor, r = Object.getOwnPropertyNames, i = Object.getPrototypeOf, a = Object.prototype.hasOwnProperty, o = (e2, t2, n2) => () => {
  if (n2) throw n2[0];
  try {
    return e2 && (t2 = e2(e2 = 0)), t2;
  } catch (e3) {
    throw n2 = [e3], e3;
  }
}, s = (e2, t2) => () => (t2 || (e2((t2 = { exports: {} }).exports, t2), e2 = null), t2.exports), c = (e2, n2) => {
  let r2 = {};
  for (var i2 in e2) t(r2, i2, { get: e2[i2], enumerable: true });
  return n2 || t(r2, Symbol.toStringTag, { value: `Module` }), r2;
}, l = (e2, i2, o2, s2) => {
  if (i2 && typeof i2 == `object` || typeof i2 == `function`) for (var c2 = r(i2), l2 = 0, u2 = c2.length, d2; l2 < u2; l2++) d2 = c2[l2], !a.call(e2, d2) && d2 !== o2 && t(e2, d2, { get: ((e3) => i2[e3]).bind(null, d2), enumerable: !(s2 = n(i2, d2)) || s2.enumerable });
  return e2;
}, u = (n2, r2, a2) => (a2 = n2 == null ? {} : e(i(n2)), l(r2 || !n2 || !n2.__esModule ? t(a2, `default`, { value: n2, enumerable: true }) : a2, n2)), d = (e2) => a.call(e2, `module.exports`) ? e2[`module.exports`] : l(t({}, `__esModule`, { value: true }), e2);
(function() {
  let e2 = document.createElement(`link`).relList;
  if (e2 && e2.supports && e2.supports(`modulepreload`)) return;
  for (let e3 of document.querySelectorAll(`link[rel="modulepreload"]`)) n2(e3);
  new MutationObserver((e3) => {
    for (let t3 of e3) if (t3.type === `childList`) for (let e4 of t3.addedNodes) e4.tagName === `LINK` && e4.rel === `modulepreload` && n2(e4);
  }).observe(document, { childList: true, subtree: true });
  function t2(e3) {
    let t3 = {};
    return e3.integrity && (t3.integrity = e3.integrity), e3.referrerPolicy && (t3.referrerPolicy = e3.referrerPolicy), e3.crossOrigin === `use-credentials` ? t3.credentials = `include` : e3.crossOrigin === `anonymous` ? t3.credentials = `omit` : t3.credentials = `same-origin`, t3;
  }
  function n2(e3) {
    if (e3.ep) return;
    e3.ep = true;
    let n3 = t2(e3);
    fetch(e3.href, n3);
  }
})();
var f = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='600'%20viewBox='0%200%2012%206'%3e%3cpath%20fill='%2300843d'%20d='M0%200h12v6H0z'/%3e%3cpath%20fill='%23fff'%20d='M0%202h12v4H0z'/%3e%3cpath%20d='M0%204h12v2H0z'/%3e%3cpath%20fill='%23c8102e'%20d='M0%200h3v6H0z'/%3e%3c/svg%3e`, p = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%3e%3cpath%20fill='%23c8102e'%20d='M0%200h900v600H0z'/%3e%3cpath%20fill='%23fff'%20d='M0%20200h900v200H0z'/%3e%3c/svg%3e`, m = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='780'%3e%3cpath%20fill='%23ef3340'%20d='M0%200h900v780H0z'/%3e%3cpath%20fill='%23fdda25'%20d='M0%200h600v780H0z'/%3e%3cpath%20d='M0%200h300v780H0z'/%3e%3c/svg%3e`, h = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1000'%20height='600'%20viewBox='0%200%205%203'%3e%3cpath%20fill='%23fff'%20d='M0%200h5v3H0z'/%3e%3cpath%20fill='%2300966E'%20d='M0%201h5v2H0z'/%3e%3cpath%20fill='%23D62612'%20d='M0%202h5v1H0z'/%3e%3c/svg%3e`, g = `` + new URL(`br-DfU4KU08.svg`, import.meta.url).href, _ = `` + new URL(`bt-CrazynNP.svg`, import.meta.url).href, v = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='600'%20viewBox='0%200%209600%204800'%3e%3cpath%20fill='red'%20d='M0%200h2400l99%2099h4602l99-99h2400v4800H7200l-99-99H2499l-99%2099H0z'/%3e%3cpath%20fill='%23fff'%20d='M2400%200h4800v4800H2400zm2490%204430-45-863a95%2095%200%200%201%20111-98l859%20151-116-320a65%2065%200%200%201%2020-73l941-762-212-99a65%2065%200%200%201-34-79l186-572-542%20115a65%2065%200%200%201-73-38l-105-247-423%20454a65%2065%200%200%201-111-57l204-1052-327%20189a65%2065%200%200%201-91-27l-332-652-332%20652a65%2065%200%200%201-91%2027l-327-189%20204%201052a65%2065%200%200%201-111%2057l-423-454-105%20247a65%2065%200%200%201-73%2038l-542-115%20186%20572a65%2065%200%200%201-34%2079l-212%2099%20941%20762a65%2065%200%200%201%2020%2073l-116%20320%20859-151a95%2095%200%200%201%20111%2098l-45%20863z'/%3e%3c/svg%3e`, y = `data:image/svg+xml,%3csvg%20width='512'%20height='512'%20viewBox='0%200%2032%2032'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M0%200h32v32H0z'%20fill='red'/%3e%3cpath%20d='M13%206h6v7h7v6h-7v7h-6v-7H6v-6h7z'%20fill='%23fff'/%3e%3c/svg%3e`, b = `data:image/svg+xml,%3csvg%20version='1.0'%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%3e%3cpath%20fill='%23d7141a'%20d='M0%200h900v600H0z'/%3e%3cpath%20fill='%23fff'%20d='M0%200h900v300H0z'/%3e%3cpath%20d='M450%20300%200%200v600z'%20fill='%2311457e'/%3e%3c/svg%3e`, x = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1000'%20height='600'%20viewBox='0%200%205%203'%3e%3cpath%20d='M0%200h5v3H0z'/%3e%3cpath%20fill='%23D00'%20d='M0%201h5v2H0z'/%3e%3cpath%20fill='%23FFCE00'%20d='M0%202h5v1H0z'/%3e%3c/svg%3e`, S = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2037%2028'%3e%3cpath%20fill='%23c8102e'%20d='M0%200h37v28H0Z'/%3e%3cpath%20stroke='%23fff'%20stroke-width='4'%20d='M0%2014h37M14%200v28'/%3e%3c/svg%3e`, C = `` + new URL(`es-CWWKyWFl.svg`, import.meta.url).href, ee = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1800'%20height='1100'%20viewBox='0%200%2018%2011'%3e%3cpath%20fill='%23fff'%20d='M0%200h18v11H0z'/%3e%3cpath%20d='M0%205.5h18M6.5%200v11'%20stroke='%23002F6C'%20stroke-width='3'/%3e%3c/svg%3e`, te = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%3e%3cpath%20fill='%23CE1126'%20d='M0%200h900v600H0'/%3e%3cpath%20fill='%23fff'%20d='M0%200h600v600H0'/%3e%3cpath%20fill='%23002654'%20d='M0%200h300v600H0'/%3e%3c/svg%3e`, ne = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2060%2030'%20width='1200'%20height='600'%3e%3cclipPath%20id='a'%3e%3cpath%20d='M0%200v30h60V0z'/%3e%3c/clipPath%3e%3cclipPath%20id='b'%3e%3cpath%20d='M30%2015h30v15zv15H0zH0V0zV0h30z'/%3e%3c/clipPath%3e%3cg%20clip-path='url(%23a)'%3e%3cpath%20d='M0%200v30h60V0z'%20fill='%23012169'/%3e%3cpath%20d='m0%200%2060%2030m0-30L0%2030'%20stroke='%23fff'%20stroke-width='6'/%3e%3cpath%20d='m0%200%2060%2030m0-30L0%2030'%20clip-path='url(%23b)'%20stroke='%23C8102E'%20stroke-width='4'/%3e%3cpath%20d='M30%200v30M0%2015h60'%20stroke='%23fff'%20stroke-width='10'/%3e%3cpath%20d='M30%200v30M0%2015h60'%20stroke='%23C8102E'%20stroke-width='6'/%3e%3c/g%3e%3c/svg%3e`, re = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20width='900'%20height='600'%20fill='%23ee1c25'%3e%3cpath%20d='M0%200h900v600H0z'/%3e%3cg%20id='a'%3e%3cpath%20d='M492.936%20125.196a27.917%2027.917%200%200%200-14.902%2041.792%2045.171%2045.171%200%200%201-20.29%2066.204%2038.65%2038.65%200%200%200-10.816%2064.313%2068.375%2068.375%200%200%201-17.068-93.914%2015.81%2015.81%200%200%201-1.109-1.047%2069.88%2069.88%200%200%200%2016.755%2095.793%2090.342%2090.342%200%200%201%2047.43-173.141'%20fill='%23fff'/%3e%3cpath%20d='m451.98%20181.1-27.565%2012.021%2029.366%206.476-19.951-22.5%202.915%2029.93'/%3e%3c/g%3e%3cg%20id='b'%3e%3cuse%20xlink:href='%23a'%20transform='rotate(72%20450%20300)'/%3e%3cuse%20xlink:href='%23a'%20transform='rotate(216%20450%20300)'/%3e%3c/g%3e%3cuse%20xlink:href='%23b'%20transform='rotate(72%20450%20300)'/%3e%3c/svg%3e`, ie = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='600'%3e%3cpath%20d='M0%200h1200v600H0'%20fill='%23477050'/%3e%3cpath%20d='M0%200h1200v400H0'%20fill='%23fff'/%3e%3cpath%20d='M0%200h1200v200H0'%20fill='%23ce2939'/%3e%3c/svg%3e`, ae = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='600'%3e%3cpath%20fill='%23169b62'%20d='M0%200h1200v600H0z'/%3e%3cpath%20fill='%23fff'%20d='M400%200h800v600H400z'/%3e%3cpath%20fill='%23ff883e'%20d='M800%200h400v600H800z'/%3e%3c/svg%3e`, oe = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20width='900'%20height='600'%20fill='%2307038D'%20viewBox='-45%20-30%2090%2060'%3e%3cpath%20fill='%23FFF'%20d='M-45-30h90v60h-90z'/%3e%3cpath%20fill='%23FF6820'%20d='M-45-30h90v20h-90z'/%3e%3cpath%20fill='%23046A38'%20d='M-45%2010h90v20h-90z'/%3e%3ccircle%20r='9.25'/%3e%3ccircle%20r='8'%20fill='%23FFF'/%3e%3ccircle%20r='1.6'/%3e%3cg%20id='d'%3e%3cg%20id='c'%3e%3cg%20id='b'%3e%3cg%20id='a'%3e%3cpath%20d='m0-8%20.3%204.814L0-.802l-.3-2.384z'/%3e%3ccircle%20cy='-8'%20r='.35'%20transform='rotate(7.5)'/%3e%3c/g%3e%3cuse%20xlink:href='%23a'%20transform='scale(-1)'/%3e%3c/g%3e%3cuse%20xlink:href='%23b'%20transform='rotate(15)'/%3e%3c/g%3e%3cuse%20xlink:href='%23c'%20transform='rotate(30)'/%3e%3c/g%3e%3cuse%20xlink:href='%23d'%20transform='rotate(60)'/%3e%3cuse%20xlink:href='%23d'%20transform='rotate(120)'/%3e%3c/svg%3e`, se = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1500'%20height='1000'%20viewBox='0%200%203%202'%3e%3cpath%20fill='%23009246'%20d='M0%200h3v2H0z'/%3e%3cpath%20fill='%23fff'%20d='M1%200h2v2H1z'/%3e%3cpath%20fill='%23ce2b37'%20d='M2%200h1v2H2z'/%3e%3c/svg%3e`, ce = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%3e%3cpath%20fill='%23fff'%20d='M0%200h900v600H0z'/%3e%3ccircle%20fill='%23bc002d'%20cx='450'%20cy='300'%20r='180'/%3e%3c/svg%3e`, w = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%20viewBox='-72%20-48%20144%2096'%3e%3cpath%20fill='%23fff'%20d='M-72-48v96H72v-96z'/%3e%3cg%20stroke='%23000'%20stroke-width='4'%3e%3cpath%20d='M-34.946-37.72-48.26-17.75m4.992%203.328%2013.313-19.97m4.992%203.329-13.312%2019.969m63.236%2042.157%206.101-9.152m1.11-1.664%206.101-9.153m4.993%203.328-6.102%209.153m-1.11%201.664-6.101%209.152m4.992%203.329%206.102-9.153m1.11-1.664%206.1-9.153M-48.259%2017.75l13.313%2019.97m4.992-3.329-6.102-9.152m-1.109-1.664-6.102-9.153m4.993-3.328%2013.312%2019.97m63.236-42.158-6.101-9.153m-1.11-1.664-6.101-9.152m4.992-3.328%2013.313%2019.969m4.992-3.328-6.102-9.153m-1.11-1.664-6.1-9.153'/%3e%3c/g%3e%3cpath%20fill='%23cd2e3a'%20d='M9.985%206.656A18%2018%200%201%201-19.97-13.313a24%2024%200%201%201%2039.938%2026.626'/%3e%3cpath%20fill='%230047a0'%20d='M0%200a12%2012%200%201%201%2019.97%2013.313%2024%2024%200%201%201-39.94-26.626A12%2012%200%201%200%200%200'/%3e%3c/svg%3e`, T = `` + new URL(`kz-CxppamuO.svg`, import.meta.url).href, le = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%20viewBox='0%200%209%206'%3e%3cpath%20fill='%2321468B'%20d='M0%200h9v6H0z'/%3e%3cpath%20fill='%23FFF'%20d='M0%200h9v4H0z'/%3e%3cpath%20fill='%23AE1C28'%20d='M0%200h9v2H0z'/%3e%3c/svg%3e`, ue = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2022%2016'%3e%3cpath%20fill='%23ba0c2f'%20d='M0%200h22v16H0z'/%3e%3cpath%20d='M0%208h22M8%200v16'%20stroke='%23fff'%20stroke-width='4'/%3e%3cpath%20d='M0%208h22M8%200v16'%20stroke='%2300205b'%20stroke-width='2'/%3e%3c/svg%3e`, de = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='640'%20height='400'%20viewBox='0%200%208%205'%3e%3cpath%20fill='%23dc143c'%20d='M0%200h8v5H0z'/%3e%3cpath%20fill='%23fff'%20d='M0%200h8v2.5H0z'/%3e%3c/svg%3e`, E = `` + new URL(`pt-C3eOmvl2.svg`, import.meta.url).href, fe = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='600'%20height='400'%20viewBox='0%200%203%202'%3e%3cpath%20fill='%23002B7F'%20d='M0%200h3v2H0z'/%3e%3cpath%20fill='%23FCD116'%20d='M1%200h2v2H1z'/%3e%3cpath%20fill='%23CE1126'%20d='M2%200h1v2H2z'/%3e%3c/svg%3e`, D = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%209%206'%20width='900'%20height='600'%3e%3cpath%20fill='%23fff'%20d='M0%200h9v3H0z'/%3e%3cpath%20fill='%23d52b1e'%20d='M0%203h9v3H0z'/%3e%3cpath%20fill='%230039a6'%20d='M0%202h9v2H0z'/%3e%3c/svg%3e`, pe = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1600'%20height='1000'%20viewBox='0%200%208%205'%3e%3cpath%20fill='%23005293'%20d='M0%200h8v5H0Z'/%3e%3cpath%20stroke='%23fecb00'%20d='M0%202.5h8M3%200v5'/%3e%3c/svg%3e`, me = `data:image/svg+xml,%3csvg%20width='900'%20height='600'%20viewBox='0%200%2054%2036'%20xmlns='http://www.w3.org/2000/svg'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20fill='%23fff'%3e%3cpath%20d='M0%200h54v36H0z'/%3e%3cpath%20d='M0%200h54v18H0z'%20fill='%23ed2939'/%3e%3ccircle%20cx='11.405'%20cy='9'%20r='6.625'/%3e%3ccircle%20cx='14.405'%20cy='9'%20r='6.625'%20fill='%23ed2939'/%3e%3cpath%20id='a'%20d='m15.03%203.475-1.014%203.12%202.655-1.928h-3.282l2.655%201.929z'/%3e%3cg%20id='b'%3e%3cuse%20xlink:href='%23a'%20transform='rotate(72%2015.03%209)'/%3e%3cuse%20xlink:href='%23a'%20transform='rotate(216%2015.03%209)'/%3e%3c/g%3e%3cuse%20xlink:href='%23b'%20transform='rotate(72%2015.03%209)'/%3e%3c/svg%3e`, he = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='800'%20viewBox='0%20-30000%2090000%2060000'%3e%3cpath%20fill='%23e30a17'%20d='M0-30000h90000v60000H0z'/%3e%3cpath%20fill='%23fff'%20d='m41750%200%2013568-4408-8386%2011541V-7133l8386%2011541zm925%208021a15000%2015000%200%201%201%200-16042%2012000%2012000%200%201%200%200%2016042z'/%3e%3c/svg%3e`, ge = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1200'%20height='800'%3e%3cpath%20fill='%23005BBB'%20d='M0%200h1200v800H0z'/%3e%3cpath%20fill='%23FFD500'%20d='M0%20400h1200v400H0z'/%3e%3c/svg%3e`, _e = `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20width='1235'%20height='650'%20viewBox='0%200%207410%203900'%3e%3cpath%20fill='%23b31942'%20d='M0%200h7410v3900H0'/%3e%3cpath%20stroke='%23FFF'%20stroke-width='300'%20d='M0%20450h7410m0%20600H0m0%20600h7410m0%20600H0m0%20600h7410m0%20600H0'/%3e%3cpath%20fill='%230a3161'%20d='M0%200h2964v2100H0'/%3e%3cg%20fill='%23FFF'%3e%3cg%20id='d'%3e%3cg%20id='c'%3e%3cg%20id='e'%3e%3cg%20id='b'%3e%3cpath%20id='a'%20d='m247%2090%2070.534%20217.082-184.66-134.164h228.253L176.466%20307.082z'/%3e%3cuse%20xlink:href='%23a'%20y='420'/%3e%3cuse%20xlink:href='%23a'%20y='840'/%3e%3cuse%20xlink:href='%23a'%20y='1260'/%3e%3c/g%3e%3cuse%20xlink:href='%23a'%20y='1680'/%3e%3c/g%3e%3cuse%20xlink:href='%23b'%20x='247'%20y='210'/%3e%3c/g%3e%3cuse%20xlink:href='%23c'%20x='494'/%3e%3c/g%3e%3cuse%20xlink:href='%23d'%20x='988'/%3e%3cuse%20xlink:href='%23c'%20x='1976'/%3e%3cuse%20xlink:href='%23e'%20x='2470'/%3e%3c/g%3e%3c/svg%3e`, ve = s(((e2) => {
  var t2 = Symbol.for(`react.transitional.element`), n2 = Symbol.for(`react.portal`), r2 = Symbol.for(`react.fragment`), i2 = Symbol.for(`react.strict_mode`), a2 = Symbol.for(`react.profiler`), o2 = Symbol.for(`react.consumer`), s2 = Symbol.for(`react.context`), c2 = Symbol.for(`react.forward_ref`), l2 = Symbol.for(`react.suspense`), u2 = Symbol.for(`react.memo`), d2 = Symbol.for(`react.lazy`), f2 = Symbol.iterator;
  function p2(e3) {
    return typeof e3 != `object` || !e3 ? null : (e3 = f2 && e3[f2] || e3[`@@iterator`], typeof e3 == `function` ? e3 : null);
  }
  var m2 = { isMounted: function() {
    return false;
  }, enqueueForceUpdate: function() {
  }, enqueueReplaceState: function() {
  }, enqueueSetState: function() {
  } }, h2 = Object.assign, g2 = {};
  function _2(e3, t3, n3) {
    this.props = e3, this.context = t3, this.refs = g2, this.updater = n3 || m2;
  }
  _2.prototype.isReactComponent = {}, _2.prototype.setState = function(e3, t3) {
    if (typeof e3 != `object` && typeof e3 != `function` && e3 != null) throw Error(`takes an object of state variables to update or a function which returns an object of state variables.`);
    this.updater.enqueueSetState(this, e3, t3, `setState`);
  }, _2.prototype.forceUpdate = function(e3) {
    this.updater.enqueueForceUpdate(this, e3, `forceUpdate`);
  };
  function v2() {
  }
  v2.prototype = _2.prototype;
  function y2(e3, t3, n3) {
    this.props = e3, this.context = t3, this.refs = g2, this.updater = n3 || m2;
  }
  var b2 = y2.prototype = new v2();
  b2.constructor = y2, h2(b2, _2.prototype), b2.isPureReactComponent = true;
  var x2 = Array.isArray, S2 = { H: null, A: null, T: null, S: null, V: null }, C2 = Object.prototype.hasOwnProperty;
  function ee2(e3, n3, r3, i3, a3, o3) {
    return r3 = o3.ref, { $$typeof: t2, type: e3, key: n3, ref: r3 === void 0 ? null : r3, props: o3 };
  }
  function te2(e3, t3) {
    return ee2(e3.type, t3, void 0, void 0, void 0, e3.props);
  }
  function ne2(e3) {
    return typeof e3 == `object` && !!e3 && e3.$$typeof === t2;
  }
  function re2(e3) {
    var t3 = { "=": `=0`, ":": `=2` };
    return `$` + e3.replace(/[=:]/g, function(e4) {
      return t3[e4];
    });
  }
  var ie2 = /\/+/g;
  function ae2(e3, t3) {
    return typeof e3 == `object` && e3 && e3.key != null ? re2(`` + e3.key) : t3.toString(36);
  }
  function oe2() {
  }
  function se2(e3) {
    switch (e3.status) {
      case `fulfilled`:
        return e3.value;
      case `rejected`:
        throw e3.reason;
      default:
        switch (typeof e3.status == `string` ? e3.then(oe2, oe2) : (e3.status = `pending`, e3.then(function(t3) {
          e3.status === `pending` && (e3.status = `fulfilled`, e3.value = t3);
        }, function(t3) {
          e3.status === `pending` && (e3.status = `rejected`, e3.reason = t3);
        })), e3.status) {
          case `fulfilled`:
            return e3.value;
          case `rejected`:
            throw e3.reason;
        }
    }
    throw e3;
  }
  function ce2(e3, r3, i3, a3, o3) {
    var s3 = typeof e3;
    (s3 === `undefined` || s3 === `boolean`) && (e3 = null);
    var c3 = false;
    if (e3 === null) c3 = true;
    else switch (s3) {
      case `bigint`:
      case `string`:
      case `number`:
        c3 = true;
        break;
      case `object`:
        switch (e3.$$typeof) {
          case t2:
          case n2:
            c3 = true;
            break;
          case d2:
            return c3 = e3._init, ce2(c3(e3._payload), r3, i3, a3, o3);
        }
    }
    if (c3) return o3 = o3(e3), c3 = a3 === `` ? `.` + ae2(e3, 0) : a3, x2(o3) ? (i3 = ``, c3 != null && (i3 = c3.replace(ie2, `$&/`) + `/`), ce2(o3, r3, i3, ``, function(e4) {
      return e4;
    })) : o3 != null && (ne2(o3) && (o3 = te2(o3, i3 + (o3.key == null || e3 && e3.key === o3.key ? `` : (`` + o3.key).replace(ie2, `$&/`) + `/`) + c3)), r3.push(o3)), 1;
    c3 = 0;
    var l3 = a3 === `` ? `.` : a3 + `:`;
    if (x2(e3)) for (var u3 = 0; u3 < e3.length; u3++) a3 = e3[u3], s3 = l3 + ae2(a3, u3), c3 += ce2(a3, r3, i3, s3, o3);
    else if (u3 = p2(e3), typeof u3 == `function`) for (e3 = u3.call(e3), u3 = 0; !(a3 = e3.next()).done; ) a3 = a3.value, s3 = l3 + ae2(a3, u3++), c3 += ce2(a3, r3, i3, s3, o3);
    else if (s3 === `object`) {
      if (typeof e3.then == `function`) return ce2(se2(e3), r3, i3, a3, o3);
      throw r3 = String(e3), Error(`Objects are not valid as a React child (found: ` + (r3 === `[object Object]` ? `object with keys {` + Object.keys(e3).join(`, `) + `}` : r3) + `). If you meant to render a collection of children, use an array instead.`);
    }
    return c3;
  }
  function w2(e3, t3, n3) {
    if (e3 == null) return e3;
    var r3 = [], i3 = 0;
    return ce2(e3, r3, ``, ``, function(e4) {
      return t3.call(n3, e4, i3++);
    }), r3;
  }
  function T2(e3) {
    if (e3._status === -1) {
      var t3 = e3._result;
      t3 = t3(), t3.then(function(t4) {
        (e3._status === 0 || e3._status === -1) && (e3._status = 1, e3._result = t4);
      }, function(t4) {
        (e3._status === 0 || e3._status === -1) && (e3._status = 2, e3._result = t4);
      }), e3._status === -1 && (e3._status = 0, e3._result = t3);
    }
    if (e3._status === 1) return e3._result.default;
    throw e3._result;
  }
  var le2 = typeof reportError == `function` ? reportError : function(e3) {
    if (typeof window == `object` && typeof window.ErrorEvent == `function`) {
      var t3 = new window.ErrorEvent(`error`, { bubbles: true, cancelable: true, message: typeof e3 == `object` && e3 && typeof e3.message == `string` ? String(e3.message) : String(e3), error: e3 });
      if (!window.dispatchEvent(t3)) return;
    } else if (typeof process == `object` && typeof process.emit == `function`) {
      process.emit(`uncaughtException`, e3);
      return;
    }
    console.error(e3);
  };
  function ue2() {
  }
  e2.Children = { map: w2, forEach: function(e3, t3, n3) {
    w2(e3, function() {
      t3.apply(this, arguments);
    }, n3);
  }, count: function(e3) {
    var t3 = 0;
    return w2(e3, function() {
      t3++;
    }), t3;
  }, toArray: function(e3) {
    return w2(e3, function(e4) {
      return e4;
    }) || [];
  }, only: function(e3) {
    if (!ne2(e3)) throw Error(`React.Children.only expected to receive a single React element child.`);
    return e3;
  } }, e2.Component = _2, e2.Fragment = r2, e2.Profiler = a2, e2.PureComponent = y2, e2.StrictMode = i2, e2.Suspense = l2, e2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = S2, e2.__COMPILER_RUNTIME = { __proto__: null, c: function(e3) {
    return S2.H.useMemoCache(e3);
  } }, e2.cache = function(e3) {
    return function() {
      return e3.apply(null, arguments);
    };
  }, e2.cloneElement = function(e3, t3, n3) {
    if (e3 == null) throw Error(`The argument must be a React element, but you passed ` + e3 + `.`);
    var r3 = h2({}, e3.props), i3 = e3.key, a3 = void 0;
    if (t3 != null) for (o3 in t3.ref !== void 0 && (a3 = void 0), t3.key !== void 0 && (i3 = `` + t3.key), t3) !C2.call(t3, o3) || o3 === `key` || o3 === `__self` || o3 === `__source` || o3 === `ref` && t3.ref === void 0 || (r3[o3] = t3[o3]);
    var o3 = arguments.length - 2;
    if (o3 === 1) r3.children = n3;
    else if (1 < o3) {
      for (var s3 = Array(o3), c3 = 0; c3 < o3; c3++) s3[c3] = arguments[c3 + 2];
      r3.children = s3;
    }
    return ee2(e3.type, i3, void 0, void 0, a3, r3);
  }, e2.createContext = function(e3) {
    return e3 = { $$typeof: s2, _currentValue: e3, _currentValue2: e3, _threadCount: 0, Provider: null, Consumer: null }, e3.Provider = e3, e3.Consumer = { $$typeof: o2, _context: e3 }, e3;
  }, e2.createElement = function(e3, t3, n3) {
    var r3, i3 = {}, a3 = null;
    if (t3 != null) for (r3 in t3.key !== void 0 && (a3 = `` + t3.key), t3) C2.call(t3, r3) && r3 !== `key` && r3 !== `__self` && r3 !== `__source` && (i3[r3] = t3[r3]);
    var o3 = arguments.length - 2;
    if (o3 === 1) i3.children = n3;
    else if (1 < o3) {
      for (var s3 = Array(o3), c3 = 0; c3 < o3; c3++) s3[c3] = arguments[c3 + 2];
      i3.children = s3;
    }
    if (e3 && e3.defaultProps) for (r3 in o3 = e3.defaultProps, o3) i3[r3] === void 0 && (i3[r3] = o3[r3]);
    return ee2(e3, a3, void 0, void 0, null, i3);
  }, e2.createRef = function() {
    return { current: null };
  }, e2.forwardRef = function(e3) {
    return { $$typeof: c2, render: e3 };
  }, e2.isValidElement = ne2, e2.lazy = function(e3) {
    return { $$typeof: d2, _payload: { _status: -1, _result: e3 }, _init: T2 };
  }, e2.memo = function(e3, t3) {
    return { $$typeof: u2, type: e3, compare: t3 === void 0 ? null : t3 };
  }, e2.startTransition = function(e3) {
    var t3 = S2.T, n3 = {};
    S2.T = n3;
    try {
      var r3 = e3(), i3 = S2.S;
      i3 !== null && i3(n3, r3), typeof r3 == `object` && r3 && typeof r3.then == `function` && r3.then(ue2, le2);
    } catch (e4) {
      le2(e4);
    } finally {
      S2.T = t3;
    }
  }, e2.unstable_useCacheRefresh = function() {
    return S2.H.useCacheRefresh();
  }, e2.use = function(e3) {
    return S2.H.use(e3);
  }, e2.useActionState = function(e3, t3, n3) {
    return S2.H.useActionState(e3, t3, n3);
  }, e2.useCallback = function(e3, t3) {
    return S2.H.useCallback(e3, t3);
  }, e2.useContext = function(e3) {
    return S2.H.useContext(e3);
  }, e2.useDebugValue = function() {
  }, e2.useDeferredValue = function(e3, t3) {
    return S2.H.useDeferredValue(e3, t3);
  }, e2.useEffect = function(e3, t3, n3) {
    var r3 = S2.H;
    if (typeof n3 == `function`) throw Error(`useEffect CRUD overload is not enabled in this build of React.`);
    return r3.useEffect(e3, t3);
  }, e2.useId = function() {
    return S2.H.useId();
  }, e2.useImperativeHandle = function(e3, t3, n3) {
    return S2.H.useImperativeHandle(e3, t3, n3);
  }, e2.useInsertionEffect = function(e3, t3) {
    return S2.H.useInsertionEffect(e3, t3);
  }, e2.useLayoutEffect = function(e3, t3) {
    return S2.H.useLayoutEffect(e3, t3);
  }, e2.useMemo = function(e3, t3) {
    return S2.H.useMemo(e3, t3);
  }, e2.useOptimistic = function(e3, t3) {
    return S2.H.useOptimistic(e3, t3);
  }, e2.useReducer = function(e3, t3, n3) {
    return S2.H.useReducer(e3, t3, n3);
  }, e2.useRef = function(e3) {
    return S2.H.useRef(e3);
  }, e2.useState = function(e3) {
    return S2.H.useState(e3);
  }, e2.useSyncExternalStore = function(e3, t3, n3) {
    return S2.H.useSyncExternalStore(e3, t3, n3);
  }, e2.useTransition = function() {
    return S2.H.useTransition();
  }, e2.version = `19.1.0`;
})), ye = s(((e2, t2) => {
  t2.exports = ve();
})), be = s(((e2) => {
  function t2(e3, t3) {
    var n3 = e3.length;
    e3.push(t3);
    a: for (; 0 < n3; ) {
      var r3 = n3 - 1 >>> 1, a3 = e3[r3];
      if (0 < i2(a3, t3)) e3[r3] = t3, e3[n3] = a3, n3 = r3;
      else break a;
    }
  }
  function n2(e3) {
    return e3.length === 0 ? null : e3[0];
  }
  function r2(e3) {
    if (e3.length === 0) return null;
    var t3 = e3[0], n3 = e3.pop();
    if (n3 !== t3) {
      e3[0] = n3;
      a: for (var r3 = 0, a3 = e3.length, o3 = a3 >>> 1; r3 < o3; ) {
        var s3 = 2 * (r3 + 1) - 1, c3 = e3[s3], l3 = s3 + 1, u3 = e3[l3];
        if (0 > i2(c3, n3)) l3 < a3 && 0 > i2(u3, c3) ? (e3[r3] = u3, e3[l3] = n3, r3 = l3) : (e3[r3] = c3, e3[s3] = n3, r3 = s3);
        else if (l3 < a3 && 0 > i2(u3, n3)) e3[r3] = u3, e3[l3] = n3, r3 = l3;
        else break a;
      }
    }
    return t3;
  }
  function i2(e3, t3) {
    var n3 = e3.sortIndex - t3.sortIndex;
    return n3 === 0 ? e3.id - t3.id : n3;
  }
  if (e2.unstable_now = void 0, typeof performance == `object` && typeof performance.now == `function`) {
    var a2 = performance;
    e2.unstable_now = function() {
      return a2.now();
    };
  } else {
    var o2 = Date, s2 = o2.now();
    e2.unstable_now = function() {
      return o2.now() - s2;
    };
  }
  var c2 = [], l2 = [], u2 = 1, d2 = null, f2 = 3, p2 = false, m2 = false, h2 = false, g2 = false, _2 = typeof setTimeout == `function` ? setTimeout : null, v2 = typeof clearTimeout == `function` ? clearTimeout : null, y2 = typeof setImmediate < `u` ? setImmediate : null;
  function b2(e3) {
    for (var i3 = n2(l2); i3 !== null; ) {
      if (i3.callback === null) r2(l2);
      else if (i3.startTime <= e3) r2(l2), i3.sortIndex = i3.expirationTime, t2(c2, i3);
      else break;
      i3 = n2(l2);
    }
  }
  function x2(e3) {
    if (h2 = false, b2(e3), !m2) if (n2(c2) !== null) m2 = true, S2 || (S2 = true, ie2());
    else {
      var t3 = n2(l2);
      t3 !== null && se2(x2, t3.startTime - e3);
    }
  }
  var S2 = false, C2 = -1, ee2 = 5, te2 = -1;
  function ne2() {
    return g2 ? true : !(e2.unstable_now() - te2 < ee2);
  }
  function re2() {
    if (g2 = false, S2) {
      var t3 = e2.unstable_now();
      te2 = t3;
      var i3 = true;
      try {
        a: {
          m2 = false, h2 && (h2 = false, v2(C2), C2 = -1), p2 = true;
          var a3 = f2;
          try {
            b: {
              for (b2(t3), d2 = n2(c2); d2 !== null && !(d2.expirationTime > t3 && ne2()); ) {
                var o3 = d2.callback;
                if (typeof o3 == `function`) {
                  d2.callback = null, f2 = d2.priorityLevel;
                  var s3 = o3(d2.expirationTime <= t3);
                  if (t3 = e2.unstable_now(), typeof s3 == `function`) {
                    d2.callback = s3, b2(t3), i3 = true;
                    break b;
                  }
                  d2 === n2(c2) && r2(c2), b2(t3);
                } else r2(c2);
                d2 = n2(c2);
              }
              if (d2 !== null) i3 = true;
              else {
                var u3 = n2(l2);
                u3 !== null && se2(x2, u3.startTime - t3), i3 = false;
              }
            }
            break a;
          } finally {
            d2 = null, f2 = a3, p2 = false;
          }
          i3 = void 0;
        }
      } finally {
        i3 ? ie2() : S2 = false;
      }
    }
  }
  var ie2;
  if (typeof y2 == `function`) ie2 = function() {
    y2(re2);
  };
  else if (typeof MessageChannel < `u`) {
    var ae2 = new MessageChannel(), oe2 = ae2.port2;
    ae2.port1.onmessage = re2, ie2 = function() {
      oe2.postMessage(null);
    };
  } else ie2 = function() {
    _2(re2, 0);
  };
  function se2(t3, n3) {
    C2 = _2(function() {
      t3(e2.unstable_now());
    }, n3);
  }
  e2.unstable_IdlePriority = 5, e2.unstable_ImmediatePriority = 1, e2.unstable_LowPriority = 4, e2.unstable_NormalPriority = 3, e2.unstable_Profiling = null, e2.unstable_UserBlockingPriority = 2, e2.unstable_cancelCallback = function(e3) {
    e3.callback = null;
  }, e2.unstable_forceFrameRate = function(e3) {
    0 > e3 || 125 < e3 ? console.error(`forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported`) : ee2 = 0 < e3 ? Math.floor(1e3 / e3) : 5;
  }, e2.unstable_getCurrentPriorityLevel = function() {
    return f2;
  }, e2.unstable_next = function(e3) {
    switch (f2) {
      case 1:
      case 2:
      case 3:
        var t3 = 3;
        break;
      default:
        t3 = f2;
    }
    var n3 = f2;
    f2 = t3;
    try {
      return e3();
    } finally {
      f2 = n3;
    }
  }, e2.unstable_requestPaint = function() {
    g2 = true;
  }, e2.unstable_runWithPriority = function(e3, t3) {
    switch (e3) {
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        break;
      default:
        e3 = 3;
    }
    var n3 = f2;
    f2 = e3;
    try {
      return t3();
    } finally {
      f2 = n3;
    }
  }, e2.unstable_scheduleCallback = function(r3, i3, a3) {
    var o3 = e2.unstable_now();
    switch (typeof a3 == `object` && a3 ? (a3 = a3.delay, a3 = typeof a3 == `number` && 0 < a3 ? o3 + a3 : o3) : a3 = o3, r3) {
      case 1:
        var s3 = -1;
        break;
      case 2:
        s3 = 250;
        break;
      case 5:
        s3 = 1073741823;
        break;
      case 4:
        s3 = 1e4;
        break;
      default:
        s3 = 5e3;
    }
    return s3 = a3 + s3, r3 = { id: u2++, callback: i3, priorityLevel: r3, startTime: a3, expirationTime: s3, sortIndex: -1 }, a3 > o3 ? (r3.sortIndex = a3, t2(l2, r3), n2(c2) === null && r3 === n2(l2) && (h2 ? (v2(C2), C2 = -1) : h2 = true, se2(x2, a3 - o3))) : (r3.sortIndex = s3, t2(c2, r3), m2 || p2 || (m2 = true, S2 || (S2 = true, ie2()))), r3;
  }, e2.unstable_shouldYield = ne2, e2.unstable_wrapCallback = function(e3) {
    var t3 = f2;
    return function() {
      var n3 = f2;
      f2 = t3;
      try {
        return e3.apply(this, arguments);
      } finally {
        f2 = n3;
      }
    };
  };
})), xe = s(((e2, t2) => {
  t2.exports = be();
})), Se = s(((e2) => {
  var t2 = ye();
  function n2(e3) {
    var t3 = `https://react.dev/errors/` + e3;
    if (1 < arguments.length) {
      t3 += `?args[]=` + encodeURIComponent(arguments[1]);
      for (var n3 = 2; n3 < arguments.length; n3++) t3 += `&args[]=` + encodeURIComponent(arguments[n3]);
    }
    return `Minified React error #` + e3 + `; visit ` + t3 + ` for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`;
  }
  function r2() {
  }
  var i2 = { d: { f: r2, r: function() {
    throw Error(n2(522));
  }, D: r2, C: r2, L: r2, m: r2, X: r2, S: r2, M: r2 }, p: 0, findDOMNode: null }, a2 = Symbol.for(`react.portal`);
  function o2(e3, t3, n3) {
    var r3 = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return { $$typeof: a2, key: r3 == null ? null : `` + r3, children: e3, containerInfo: t3, implementation: n3 };
  }
  var s2 = t2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function c2(e3, t3) {
    if (e3 === `font`) return ``;
    if (typeof t3 == `string`) return t3 === `use-credentials` ? t3 : ``;
  }
  e2.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = i2, e2.createPortal = function(e3, t3) {
    var r3 = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
    if (!t3 || t3.nodeType !== 1 && t3.nodeType !== 9 && t3.nodeType !== 11) throw Error(n2(299));
    return o2(e3, t3, null, r3);
  }, e2.flushSync = function(e3) {
    var t3 = s2.T, n3 = i2.p;
    try {
      if (s2.T = null, i2.p = 2, e3) return e3();
    } finally {
      s2.T = t3, i2.p = n3, i2.d.f();
    }
  }, e2.preconnect = function(e3, t3) {
    typeof e3 == `string` && (t3 ? (t3 = t3.crossOrigin, t3 = typeof t3 == `string` ? t3 === `use-credentials` ? t3 : `` : void 0) : t3 = null, i2.d.C(e3, t3));
  }, e2.prefetchDNS = function(e3) {
    typeof e3 == `string` && i2.d.D(e3);
  }, e2.preinit = function(e3, t3) {
    if (typeof e3 == `string` && t3 && typeof t3.as == `string`) {
      var n3 = t3.as, r3 = c2(n3, t3.crossOrigin), a3 = typeof t3.integrity == `string` ? t3.integrity : void 0, o3 = typeof t3.fetchPriority == `string` ? t3.fetchPriority : void 0;
      n3 === `style` ? i2.d.S(e3, typeof t3.precedence == `string` ? t3.precedence : void 0, { crossOrigin: r3, integrity: a3, fetchPriority: o3 }) : n3 === `script` && i2.d.X(e3, { crossOrigin: r3, integrity: a3, fetchPriority: o3, nonce: typeof t3.nonce == `string` ? t3.nonce : void 0 });
    }
  }, e2.preinitModule = function(e3, t3) {
    if (typeof e3 == `string`) if (typeof t3 == `object` && t3) {
      if (t3.as == null || t3.as === `script`) {
        var n3 = c2(t3.as, t3.crossOrigin);
        i2.d.M(e3, { crossOrigin: n3, integrity: typeof t3.integrity == `string` ? t3.integrity : void 0, nonce: typeof t3.nonce == `string` ? t3.nonce : void 0 });
      }
    } else t3 ?? i2.d.M(e3);
  }, e2.preload = function(e3, t3) {
    if (typeof e3 == `string` && typeof t3 == `object` && t3 && typeof t3.as == `string`) {
      var n3 = t3.as, r3 = c2(n3, t3.crossOrigin);
      i2.d.L(e3, n3, { crossOrigin: r3, integrity: typeof t3.integrity == `string` ? t3.integrity : void 0, nonce: typeof t3.nonce == `string` ? t3.nonce : void 0, type: typeof t3.type == `string` ? t3.type : void 0, fetchPriority: typeof t3.fetchPriority == `string` ? t3.fetchPriority : void 0, referrerPolicy: typeof t3.referrerPolicy == `string` ? t3.referrerPolicy : void 0, imageSrcSet: typeof t3.imageSrcSet == `string` ? t3.imageSrcSet : void 0, imageSizes: typeof t3.imageSizes == `string` ? t3.imageSizes : void 0, media: typeof t3.media == `string` ? t3.media : void 0 });
    }
  }, e2.preloadModule = function(e3, t3) {
    if (typeof e3 == `string`) if (t3) {
      var n3 = c2(t3.as, t3.crossOrigin);
      i2.d.m(e3, { as: typeof t3.as == `string` && t3.as !== `script` ? t3.as : void 0, crossOrigin: n3, integrity: typeof t3.integrity == `string` ? t3.integrity : void 0 });
    } else i2.d.m(e3);
  }, e2.requestFormReset = function(e3) {
    i2.d.r(e3);
  }, e2.unstable_batchedUpdates = function(e3, t3) {
    return e3(t3);
  }, e2.useFormState = function(e3, t3, n3) {
    return s2.H.useFormState(e3, t3, n3);
  }, e2.useFormStatus = function() {
    return s2.H.useHostTransitionStatus();
  }, e2.version = `19.1.0`;
})), Ce = s(((e2, t2) => {
  function n2() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > `u` || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != `function`)) try {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n2);
    } catch (e3) {
      console.error(e3);
    }
  }
  n2(), t2.exports = Se();
})), we = s(((e2) => {
  var t2 = xe(), n2 = ye(), r2 = Ce();
  function i2(e3) {
    var t3 = `https://react.dev/errors/` + e3;
    if (1 < arguments.length) {
      t3 += `?args[]=` + encodeURIComponent(arguments[1]);
      for (var n3 = 2; n3 < arguments.length; n3++) t3 += `&args[]=` + encodeURIComponent(arguments[n3]);
    }
    return `Minified React error #` + e3 + `; visit ` + t3 + ` for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`;
  }
  function a2(e3) {
    return !(!e3 || e3.nodeType !== 1 && e3.nodeType !== 9 && e3.nodeType !== 11);
  }
  function o2(e3) {
    var t3 = e3, n3 = e3;
    if (e3.alternate) for (; t3.return; ) t3 = t3.return;
    else {
      e3 = t3;
      do
        t3 = e3, t3.flags & 4098 && (n3 = t3.return), e3 = t3.return;
      while (e3);
    }
    return t3.tag === 3 ? n3 : null;
  }
  function s2(e3) {
    if (e3.tag === 13) {
      var t3 = e3.memoizedState;
      if (t3 === null && (e3 = e3.alternate, e3 !== null && (t3 = e3.memoizedState)), t3 !== null) return t3.dehydrated;
    }
    return null;
  }
  function c2(e3) {
    if (o2(e3) !== e3) throw Error(i2(188));
  }
  function l2(e3) {
    var t3 = e3.alternate;
    if (!t3) {
      if (t3 = o2(e3), t3 === null) throw Error(i2(188));
      return t3 === e3 ? e3 : null;
    }
    for (var n3 = e3, r3 = t3; ; ) {
      var a3 = n3.return;
      if (a3 === null) break;
      var s3 = a3.alternate;
      if (s3 === null) {
        if (r3 = a3.return, r3 !== null) {
          n3 = r3;
          continue;
        }
        break;
      }
      if (a3.child === s3.child) {
        for (s3 = a3.child; s3; ) {
          if (s3 === n3) return c2(a3), e3;
          if (s3 === r3) return c2(a3), t3;
          s3 = s3.sibling;
        }
        throw Error(i2(188));
      }
      if (n3.return !== r3.return) n3 = a3, r3 = s3;
      else {
        for (var l3 = false, u3 = a3.child; u3; ) {
          if (u3 === n3) {
            l3 = true, n3 = a3, r3 = s3;
            break;
          }
          if (u3 === r3) {
            l3 = true, r3 = a3, n3 = s3;
            break;
          }
          u3 = u3.sibling;
        }
        if (!l3) {
          for (u3 = s3.child; u3; ) {
            if (u3 === n3) {
              l3 = true, n3 = s3, r3 = a3;
              break;
            }
            if (u3 === r3) {
              l3 = true, r3 = s3, n3 = a3;
              break;
            }
            u3 = u3.sibling;
          }
          if (!l3) throw Error(i2(189));
        }
      }
      if (n3.alternate !== r3) throw Error(i2(190));
    }
    if (n3.tag !== 3) throw Error(i2(188));
    return n3.stateNode.current === n3 ? e3 : t3;
  }
  function u2(e3) {
    var t3 = e3.tag;
    if (t3 === 5 || t3 === 26 || t3 === 27 || t3 === 6) return e3;
    for (e3 = e3.child; e3 !== null; ) {
      if (t3 = u2(e3), t3 !== null) return t3;
      e3 = e3.sibling;
    }
    return null;
  }
  var d2 = Object.assign, f2 = Symbol.for(`react.element`), p2 = Symbol.for(`react.transitional.element`), m2 = Symbol.for(`react.portal`), h2 = Symbol.for(`react.fragment`), g2 = Symbol.for(`react.strict_mode`), _2 = Symbol.for(`react.profiler`), v2 = Symbol.for(`react.provider`), y2 = Symbol.for(`react.consumer`), b2 = Symbol.for(`react.context`), x2 = Symbol.for(`react.forward_ref`), S2 = Symbol.for(`react.suspense`), C2 = Symbol.for(`react.suspense_list`), ee2 = Symbol.for(`react.memo`), te2 = Symbol.for(`react.lazy`), ne2 = Symbol.for(`react.activity`), re2 = Symbol.for(`react.memo_cache_sentinel`), ie2 = Symbol.iterator;
  function ae2(e3) {
    return typeof e3 != `object` || !e3 ? null : (e3 = ie2 && e3[ie2] || e3[`@@iterator`], typeof e3 == `function` ? e3 : null);
  }
  var oe2 = Symbol.for(`react.client.reference`);
  function se2(e3) {
    if (e3 == null) return null;
    if (typeof e3 == `function`) return e3.$$typeof === oe2 ? null : e3.displayName || e3.name || null;
    if (typeof e3 == `string`) return e3;
    switch (e3) {
      case h2:
        return `Fragment`;
      case _2:
        return `Profiler`;
      case g2:
        return `StrictMode`;
      case S2:
        return `Suspense`;
      case C2:
        return `SuspenseList`;
      case ne2:
        return `Activity`;
    }
    if (typeof e3 == `object`) switch (e3.$$typeof) {
      case m2:
        return `Portal`;
      case b2:
        return (e3.displayName || `Context`) + `.Provider`;
      case y2:
        return (e3._context.displayName || `Context`) + `.Consumer`;
      case x2:
        var t3 = e3.render;
        return e3 = e3.displayName, e3 ||= (e3 = t3.displayName || t3.name || ``, e3 === `` ? `ForwardRef` : `ForwardRef(` + e3 + `)`), e3;
      case ee2:
        return t3 = e3.displayName || null, t3 === null ? se2(e3.type) || `Memo` : t3;
      case te2:
        t3 = e3._payload, e3 = e3._init;
        try {
          return se2(e3(t3));
        } catch {
        }
    }
    return null;
  }
  var ce2 = Array.isArray, w2 = n2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, T2 = r2.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, le2 = { pending: false, data: null, method: null, action: null }, ue2 = [], de2 = -1;
  function E2(e3) {
    return { current: e3 };
  }
  function fe2(e3) {
    0 > de2 || (e3.current = ue2[de2], ue2[de2] = null, de2--);
  }
  function D2(e3, t3) {
    de2++, ue2[de2] = e3.current, e3.current = t3;
  }
  var pe2 = E2(null), me2 = E2(null), he2 = E2(null), ge2 = E2(null);
  function _e2(e3, t3) {
    switch (D2(he2, t3), D2(me2, e3), D2(pe2, null), t3.nodeType) {
      case 9:
      case 11:
        e3 = (e3 = t3.documentElement) && (e3 = e3.namespaceURI) ? Ad2(e3) : 0;
        break;
      default:
        if (e3 = t3.tagName, t3 = t3.namespaceURI) t3 = Ad2(t3), e3 = jd2(t3, e3);
        else switch (e3) {
          case `svg`:
            e3 = 1;
            break;
          case `math`:
            e3 = 2;
            break;
          default:
            e3 = 0;
        }
    }
    fe2(pe2), D2(pe2, e3);
  }
  function ve2() {
    fe2(pe2), fe2(me2), fe2(he2);
  }
  function be2(e3) {
    e3.memoizedState !== null && D2(ge2, e3);
    var t3 = pe2.current, n3 = jd2(t3, e3.type);
    t3 !== n3 && (D2(me2, e3), D2(pe2, n3));
  }
  function Se2(e3) {
    me2.current === e3 && (fe2(pe2), fe2(me2)), ge2.current === e3 && (fe2(ge2), Rf2._currentValue = le2);
  }
  var we2 = Object.prototype.hasOwnProperty, Te2 = t2.unstable_scheduleCallback, Ee2 = t2.unstable_cancelCallback, De2 = t2.unstable_shouldYield, O2 = t2.unstable_requestPaint, Oe2 = t2.unstable_now, ke2 = t2.unstable_getCurrentPriorityLevel, Ae2 = t2.unstable_ImmediatePriority, je2 = t2.unstable_UserBlockingPriority, Me2 = t2.unstable_NormalPriority, Ne2 = t2.unstable_LowPriority, Pe2 = t2.unstable_IdlePriority, Fe2 = t2.log, Ie2 = t2.unstable_setDisableYieldValue, Le2 = null, Re2 = null;
  function ze2(e3) {
    if (typeof Fe2 == `function` && Ie2(e3), Re2 && typeof Re2.setStrictMode == `function`) try {
      Re2.setStrictMode(Le2, e3);
    } catch {
    }
  }
  var k2 = Math.clz32 ? Math.clz32 : He2, Be2 = Math.log, Ve2 = Math.LN2;
  function He2(e3) {
    return e3 >>>= 0, e3 === 0 ? 32 : 31 - (Be2(e3) / Ve2 | 0) | 0;
  }
  var Ue2 = 256, We2 = 4194304;
  function Ge2(e3) {
    var t3 = e3 & 42;
    if (t3 !== 0) return t3;
    switch (e3 & -e3) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return e3 & 4194048;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return e3 & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return e3;
    }
  }
  function Ke2(e3, t3, n3) {
    var r3 = e3.pendingLanes;
    if (r3 === 0) return 0;
    var i3 = 0, a3 = e3.suspendedLanes, o3 = e3.pingedLanes;
    e3 = e3.warmLanes;
    var s3 = r3 & 134217727;
    return s3 === 0 ? (s3 = r3 & ~a3, s3 === 0 ? o3 === 0 ? n3 || (n3 = r3 & ~e3, n3 !== 0 && (i3 = Ge2(n3))) : i3 = Ge2(o3) : i3 = Ge2(s3)) : (r3 = s3 & ~a3, r3 === 0 ? (o3 &= s3, o3 === 0 ? n3 || (n3 = s3 & ~e3, n3 !== 0 && (i3 = Ge2(n3))) : i3 = Ge2(o3)) : i3 = Ge2(r3)), i3 === 0 ? 0 : t3 !== 0 && t3 !== i3 && (t3 & a3) === 0 && (a3 = i3 & -i3, n3 = t3 & -t3, a3 >= n3 || a3 === 32 && n3 & 4194048) ? t3 : i3;
  }
  function qe2(e3, t3) {
    return (e3.pendingLanes & ~(e3.suspendedLanes & ~e3.pingedLanes) & t3) === 0;
  }
  function Je2(e3, t3) {
    switch (e3) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return t3 + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t3 + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function Ye2() {
    var e3 = Ue2;
    return Ue2 <<= 1, !(Ue2 & 4194048) && (Ue2 = 256), e3;
  }
  function Xe2() {
    var e3 = We2;
    return We2 <<= 1, !(We2 & 62914560) && (We2 = 4194304), e3;
  }
  function Ze2(e3) {
    for (var t3 = [], n3 = 0; 31 > n3; n3++) t3.push(e3);
    return t3;
  }
  function Qe2(e3, t3) {
    e3.pendingLanes |= t3, t3 !== 268435456 && (e3.suspendedLanes = 0, e3.pingedLanes = 0, e3.warmLanes = 0);
  }
  function $e2(e3, t3, n3, r3, i3, a3) {
    var o3 = e3.pendingLanes;
    e3.pendingLanes = n3, e3.suspendedLanes = 0, e3.pingedLanes = 0, e3.warmLanes = 0, e3.expiredLanes &= n3, e3.entangledLanes &= n3, e3.errorRecoveryDisabledLanes &= n3, e3.shellSuspendCounter = 0;
    var s3 = e3.entanglements, c3 = e3.expirationTimes, l3 = e3.hiddenUpdates;
    for (n3 = o3 & ~n3; 0 < n3; ) {
      var u3 = 31 - k2(n3), d3 = 1 << u3;
      s3[u3] = 0, c3[u3] = -1;
      var f3 = l3[u3];
      if (f3 !== null) for (l3[u3] = null, u3 = 0; u3 < f3.length; u3++) {
        var p3 = f3[u3];
        p3 !== null && (p3.lane &= -536870913);
      }
      n3 &= ~d3;
    }
    r3 !== 0 && et2(e3, r3, 0), a3 !== 0 && i3 === 0 && e3.tag !== 0 && (e3.suspendedLanes |= a3 & ~(o3 & ~t3));
  }
  function et2(e3, t3, n3) {
    e3.pendingLanes |= t3, e3.suspendedLanes &= ~t3;
    var r3 = 31 - k2(t3);
    e3.entangledLanes |= t3, e3.entanglements[r3] = e3.entanglements[r3] | 1073741824 | n3 & 4194090;
  }
  function tt2(e3, t3) {
    var n3 = e3.entangledLanes |= t3;
    for (e3 = e3.entanglements; n3; ) {
      var r3 = 31 - k2(n3), i3 = 1 << r3;
      i3 & t3 | e3[r3] & t3 && (e3[r3] |= t3), n3 &= ~i3;
    }
  }
  function nt2(e3) {
    switch (e3) {
      case 2:
        e3 = 1;
        break;
      case 8:
        e3 = 4;
        break;
      case 32:
        e3 = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        e3 = 128;
        break;
      case 268435456:
        e3 = 134217728;
        break;
      default:
        e3 = 0;
    }
    return e3;
  }
  function rt2(e3) {
    return e3 &= -e3, 2 < e3 ? 8 < e3 ? e3 & 134217727 ? 32 : 268435456 : 8 : 2;
  }
  function it2() {
    var e3 = T2.p;
    return e3 === 0 ? (e3 = window.event, e3 === void 0 ? 32 : $f2(e3.type)) : e3;
  }
  function at2(e3, t3) {
    var n3 = T2.p;
    try {
      return T2.p = e3, t3();
    } finally {
      T2.p = n3;
    }
  }
  var ot2 = Math.random().toString(36).slice(2), st2 = `__reactFiber$` + ot2, ct2 = `__reactProps$` + ot2, lt2 = `__reactContainer$` + ot2, ut2 = `__reactEvents$` + ot2, dt2 = `__reactListeners$` + ot2, ft2 = `__reactHandles$` + ot2, pt2 = `__reactResources$` + ot2, mt2 = `__reactMarker$` + ot2;
  function ht2(e3) {
    delete e3[st2], delete e3[ct2], delete e3[ut2], delete e3[dt2], delete e3[ft2];
  }
  function gt2(e3) {
    var t3 = e3[st2];
    if (t3) return t3;
    for (var n3 = e3.parentNode; n3; ) {
      if (t3 = n3[lt2] || n3[st2]) {
        if (n3 = t3.alternate, t3.child !== null || n3 !== null && n3.child !== null) for (e3 = Yd2(e3); e3 !== null; ) {
          if (n3 = e3[st2]) return n3;
          e3 = Yd2(e3);
        }
        return t3;
      }
      e3 = n3, n3 = e3.parentNode;
    }
    return null;
  }
  function _t2(e3) {
    if (e3 = e3[st2] || e3[lt2]) {
      var t3 = e3.tag;
      if (t3 === 5 || t3 === 6 || t3 === 13 || t3 === 26 || t3 === 27 || t3 === 3) return e3;
    }
    return null;
  }
  function A2(e3) {
    var t3 = e3.tag;
    if (t3 === 5 || t3 === 26 || t3 === 27 || t3 === 6) return e3.stateNode;
    throw Error(i2(33));
  }
  function vt2(e3) {
    var t3 = e3[pt2];
    return t3 ||= e3[pt2] = { hoistableStyles: /* @__PURE__ */ new Map(), hoistableScripts: /* @__PURE__ */ new Map() }, t3;
  }
  function j2(e3) {
    e3[mt2] = true;
  }
  var yt2 = /* @__PURE__ */ new Set(), bt2 = {};
  function xt2(e3, t3) {
    St2(e3, t3), St2(e3 + `Capture`, t3);
  }
  function St2(e3, t3) {
    for (bt2[e3] = t3, e3 = 0; e3 < t3.length; e3++) yt2.add(t3[e3]);
  }
  var Ct2 = RegExp(`^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`), wt2 = {}, Tt2 = {};
  function Et2(e3) {
    return we2.call(Tt2, e3) ? true : we2.call(wt2, e3) ? false : Ct2.test(e3) ? Tt2[e3] = true : (wt2[e3] = true, false);
  }
  function Dt2(e3, t3, n3) {
    if (Et2(t3)) if (n3 === null) e3.removeAttribute(t3);
    else {
      switch (typeof n3) {
        case `undefined`:
        case `function`:
        case `symbol`:
          e3.removeAttribute(t3);
          return;
        case `boolean`:
          var r3 = t3.toLowerCase().slice(0, 5);
          if (r3 !== `data-` && r3 !== `aria-`) {
            e3.removeAttribute(t3);
            return;
          }
      }
      e3.setAttribute(t3, `` + n3);
    }
  }
  function Ot2(e3, t3, n3) {
    if (n3 === null) e3.removeAttribute(t3);
    else {
      switch (typeof n3) {
        case `undefined`:
        case `function`:
        case `symbol`:
        case `boolean`:
          e3.removeAttribute(t3);
          return;
      }
      e3.setAttribute(t3, `` + n3);
    }
  }
  function kt2(e3, t3, n3, r3) {
    if (r3 === null) e3.removeAttribute(n3);
    else {
      switch (typeof r3) {
        case `undefined`:
        case `function`:
        case `symbol`:
        case `boolean`:
          e3.removeAttribute(n3);
          return;
      }
      e3.setAttributeNS(t3, n3, `` + r3);
    }
  }
  var At2, jt2;
  function Mt2(e3) {
    if (At2 === void 0) try {
      throw Error();
    } catch (e4) {
      var t3 = e4.stack.trim().match(/\n( *(at )?)/);
      At2 = t3 && t3[1] || ``, jt2 = -1 < e4.stack.indexOf(`
    at`) ? ` (<anonymous>)` : -1 < e4.stack.indexOf(`@`) ? `@unknown:0:0` : ``;
    }
    return `
` + At2 + e3 + jt2;
  }
  var Nt2 = false;
  function Pt2(e3, t3) {
    if (!e3 || Nt2) return ``;
    Nt2 = true;
    var n3 = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var r3 = { DetermineComponentFrameRoot: function() {
        try {
          if (t3) {
            var n4 = function() {
              throw Error();
            };
            if (Object.defineProperty(n4.prototype, "props", { set: function() {
              throw Error();
            } }), typeof Reflect == `object` && Reflect.construct) {
              try {
                Reflect.construct(n4, []);
              } catch (e4) {
                var r4 = e4;
              }
              Reflect.construct(e3, [], n4);
            } else {
              try {
                n4.call();
              } catch (e4) {
                r4 = e4;
              }
              e3.call(n4.prototype);
            }
          } else {
            try {
              throw Error();
            } catch (e4) {
              r4 = e4;
            }
            (n4 = e3()) && typeof n4.catch == `function` && n4.catch(function() {
            });
          }
        } catch (e4) {
          if (e4 && r4 && typeof e4.stack == `string`) return [e4.stack, r4.stack];
        }
        return [null, null];
      } };
      r3.DetermineComponentFrameRoot.displayName = `DetermineComponentFrameRoot`;
      var i3 = Object.getOwnPropertyDescriptor(r3.DetermineComponentFrameRoot, `name`);
      i3 && i3.configurable && Object.defineProperty(r3.DetermineComponentFrameRoot, "name", { value: `DetermineComponentFrameRoot` });
      var a3 = r3.DetermineComponentFrameRoot(), o3 = a3[0], s3 = a3[1];
      if (o3 && s3) {
        var c3 = o3.split(`
`), l3 = s3.split(`
`);
        for (i3 = r3 = 0; r3 < c3.length && !c3[r3].includes(`DetermineComponentFrameRoot`); ) r3++;
        for (; i3 < l3.length && !l3[i3].includes(`DetermineComponentFrameRoot`); ) i3++;
        if (r3 === c3.length || i3 === l3.length) for (r3 = c3.length - 1, i3 = l3.length - 1; 1 <= r3 && 0 <= i3 && c3[r3] !== l3[i3]; ) i3--;
        for (; 1 <= r3 && 0 <= i3; r3--, i3--) if (c3[r3] !== l3[i3]) {
          if (r3 !== 1 || i3 !== 1) do
            if (r3--, i3--, 0 > i3 || c3[r3] !== l3[i3]) {
              var u3 = `
` + c3[r3].replace(` at new `, ` at `);
              return e3.displayName && u3.includes(`<anonymous>`) && (u3 = u3.replace(`<anonymous>`, e3.displayName)), u3;
            }
          while (1 <= r3 && 0 <= i3);
          break;
        }
      }
    } finally {
      Nt2 = false, Error.prepareStackTrace = n3;
    }
    return (n3 = e3 ? e3.displayName || e3.name : ``) ? Mt2(n3) : ``;
  }
  function Ft2(e3) {
    switch (e3.tag) {
      case 26:
      case 27:
      case 5:
        return Mt2(e3.type);
      case 16:
        return Mt2(`Lazy`);
      case 13:
        return Mt2(`Suspense`);
      case 19:
        return Mt2(`SuspenseList`);
      case 0:
      case 15:
        return Pt2(e3.type, false);
      case 11:
        return Pt2(e3.type.render, false);
      case 1:
        return Pt2(e3.type, true);
      case 31:
        return Mt2(`Activity`);
      default:
        return ``;
    }
  }
  function It2(e3) {
    try {
      var t3 = ``;
      do
        t3 += Ft2(e3), e3 = e3.return;
      while (e3);
      return t3;
    } catch (e4) {
      return `
Error generating stack: ` + e4.message + `
` + e4.stack;
    }
  }
  function Lt2(e3) {
    switch (typeof e3) {
      case `bigint`:
      case `boolean`:
      case `number`:
      case `string`:
      case `undefined`:
        return e3;
      case `object`:
        return e3;
      default:
        return ``;
    }
  }
  function Rt2(e3) {
    var t3 = e3.type;
    return (e3 = e3.nodeName) && e3.toLowerCase() === `input` && (t3 === `checkbox` || t3 === `radio`);
  }
  function zt2(e3) {
    var t3 = Rt2(e3) ? `checked` : `value`, n3 = Object.getOwnPropertyDescriptor(e3.constructor.prototype, t3), r3 = `` + e3[t3];
    if (!e3.hasOwnProperty(t3) && n3 !== void 0 && typeof n3.get == `function` && typeof n3.set == `function`) {
      var i3 = n3.get, a3 = n3.set;
      return Object.defineProperty(e3, t3, { configurable: true, get: function() {
        return i3.call(this);
      }, set: function(e4) {
        r3 = `` + e4, a3.call(this, e4);
      } }), Object.defineProperty(e3, t3, { enumerable: n3.enumerable }), { getValue: function() {
        return r3;
      }, setValue: function(e4) {
        r3 = `` + e4;
      }, stopTracking: function() {
        e3._valueTracker = null, delete e3[t3];
      } };
    }
  }
  function Bt2(e3) {
    e3._valueTracker ||= zt2(e3);
  }
  function Vt2(e3) {
    if (!e3) return false;
    var t3 = e3._valueTracker;
    if (!t3) return true;
    var n3 = t3.getValue(), r3 = ``;
    return e3 && (r3 = Rt2(e3) ? e3.checked ? `true` : `false` : e3.value), e3 = r3, e3 === n3 ? false : (t3.setValue(e3), true);
  }
  function Ht2(e3) {
    if (e3 ||= typeof document < `u` ? document : void 0, e3 === void 0) return null;
    try {
      return e3.activeElement || e3.body;
    } catch {
      return e3.body;
    }
  }
  var Ut2 = /[\n"\\]/g;
  function Wt2(e3) {
    return e3.replace(Ut2, function(e4) {
      return `\\` + e4.charCodeAt(0).toString(16) + ` `;
    });
  }
  function Gt2(e3, t3, n3, r3, i3, a3, o3, s3) {
    e3.name = ``, o3 != null && typeof o3 != `function` && typeof o3 != `symbol` && typeof o3 != `boolean` ? e3.type = o3 : e3.removeAttribute(`type`), t3 == null ? o3 !== `submit` && o3 !== `reset` || e3.removeAttribute(`value`) : o3 === `number` ? (t3 === 0 && e3.value === `` || e3.value != t3) && (e3.value = `` + Lt2(t3)) : e3.value !== `` + Lt2(t3) && (e3.value = `` + Lt2(t3)), t3 == null ? n3 == null ? r3 != null && e3.removeAttribute(`value`) : Kt2(e3, o3, Lt2(n3)) : Kt2(e3, o3, Lt2(t3)), i3 == null && a3 != null && (e3.defaultChecked = !!a3), i3 != null && (e3.checked = i3 && typeof i3 != `function` && typeof i3 != `symbol`), s3 != null && typeof s3 != `function` && typeof s3 != `symbol` && typeof s3 != `boolean` ? e3.name = `` + Lt2(s3) : e3.removeAttribute(`name`);
  }
  function M2(e3, t3, n3, r3, i3, a3, o3, s3) {
    if (a3 != null && typeof a3 != `function` && typeof a3 != `symbol` && typeof a3 != `boolean` && (e3.type = a3), t3 != null || n3 != null) {
      if (!(a3 !== `submit` && a3 !== `reset` || t3 != null)) return;
      n3 = n3 == null ? `` : `` + Lt2(n3), t3 = t3 == null ? n3 : `` + Lt2(t3), s3 || t3 === e3.value || (e3.value = t3), e3.defaultValue = t3;
    }
    r3 ??= i3, r3 = typeof r3 != `function` && typeof r3 != `symbol` && !!r3, e3.checked = s3 ? e3.checked : !!r3, e3.defaultChecked = !!r3, o3 != null && typeof o3 != `function` && typeof o3 != `symbol` && typeof o3 != `boolean` && (e3.name = o3);
  }
  function Kt2(e3, t3, n3) {
    t3 === `number` && Ht2(e3.ownerDocument) === e3 || e3.defaultValue === `` + n3 || (e3.defaultValue = `` + n3);
  }
  function qt2(e3, t3, n3, r3) {
    if (e3 = e3.options, t3) {
      t3 = {};
      for (var i3 = 0; i3 < n3.length; i3++) t3[`$` + n3[i3]] = true;
      for (n3 = 0; n3 < e3.length; n3++) i3 = t3.hasOwnProperty(`$` + e3[n3].value), e3[n3].selected !== i3 && (e3[n3].selected = i3), i3 && r3 && (e3[n3].defaultSelected = true);
    } else {
      for (n3 = `` + Lt2(n3), t3 = null, i3 = 0; i3 < e3.length; i3++) {
        if (e3[i3].value === n3) {
          e3[i3].selected = true, r3 && (e3[i3].defaultSelected = true);
          return;
        }
        t3 !== null || e3[i3].disabled || (t3 = e3[i3]);
      }
      t3 !== null && (t3.selected = true);
    }
  }
  function Jt2(e3, t3, n3) {
    if (t3 != null && (t3 = `` + Lt2(t3), t3 !== e3.value && (e3.value = t3), n3 == null)) {
      e3.defaultValue !== t3 && (e3.defaultValue = t3);
      return;
    }
    e3.defaultValue = n3 == null ? `` : `` + Lt2(n3);
  }
  function Yt2(e3, t3, n3, r3) {
    if (t3 == null) {
      if (r3 != null) {
        if (n3 != null) throw Error(i2(92));
        if (ce2(r3)) {
          if (1 < r3.length) throw Error(i2(93));
          r3 = r3[0];
        }
        n3 = r3;
      }
      n3 ??= ``, t3 = n3;
    }
    n3 = Lt2(t3), e3.defaultValue = n3, r3 = e3.textContent, r3 === n3 && r3 !== `` && r3 !== null && (e3.value = r3);
  }
  function N2(e3, t3) {
    if (t3) {
      var n3 = e3.firstChild;
      if (n3 && n3 === e3.lastChild && n3.nodeType === 3) {
        n3.nodeValue = t3;
        return;
      }
    }
    e3.textContent = t3;
  }
  var Xt2 = new Set(`animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp`.split(` `));
  function Zt2(e3, t3, n3) {
    var r3 = t3.indexOf(`--`) === 0;
    n3 == null || typeof n3 == `boolean` || n3 === `` ? r3 ? e3.setProperty(t3, ``) : t3 === `float` ? e3.cssFloat = `` : e3[t3] = `` : r3 ? e3.setProperty(t3, n3) : typeof n3 != `number` || n3 === 0 || Xt2.has(t3) ? t3 === `float` ? e3.cssFloat = n3 : e3[t3] = (`` + n3).trim() : e3[t3] = n3 + `px`;
  }
  function Qt2(e3, t3, n3) {
    if (t3 != null && typeof t3 != `object`) throw Error(i2(62));
    if (e3 = e3.style, n3 != null) {
      for (var r3 in n3) !n3.hasOwnProperty(r3) || t3 != null && t3.hasOwnProperty(r3) || (r3.indexOf(`--`) === 0 ? e3.setProperty(r3, ``) : r3 === `float` ? e3.cssFloat = `` : e3[r3] = ``);
      for (var a3 in t3) r3 = t3[a3], t3.hasOwnProperty(a3) && n3[a3] !== r3 && Zt2(e3, a3, r3);
    } else for (var o3 in t3) t3.hasOwnProperty(o3) && Zt2(e3, o3, t3[o3]);
  }
  function $t2(e3) {
    if (e3.indexOf(`-`) === -1) return false;
    switch (e3) {
      case `annotation-xml`:
      case `color-profile`:
      case `font-face`:
      case `font-face-src`:
      case `font-face-uri`:
      case `font-face-format`:
      case `font-face-name`:
      case `missing-glyph`:
        return false;
      default:
        return true;
    }
  }
  var en2 = /* @__PURE__ */ new Map([[`acceptCharset`, `accept-charset`], [`htmlFor`, `for`], [`httpEquiv`, `http-equiv`], [`crossOrigin`, `crossorigin`], [`accentHeight`, `accent-height`], [`alignmentBaseline`, `alignment-baseline`], [`arabicForm`, `arabic-form`], [`baselineShift`, `baseline-shift`], [`capHeight`, `cap-height`], [`clipPath`, `clip-path`], [`clipRule`, `clip-rule`], [`colorInterpolation`, `color-interpolation`], [`colorInterpolationFilters`, `color-interpolation-filters`], [`colorProfile`, `color-profile`], [`colorRendering`, `color-rendering`], [`dominantBaseline`, `dominant-baseline`], [`enableBackground`, `enable-background`], [`fillOpacity`, `fill-opacity`], [`fillRule`, `fill-rule`], [`floodColor`, `flood-color`], [`floodOpacity`, `flood-opacity`], [`fontFamily`, `font-family`], [`fontSize`, `font-size`], [`fontSizeAdjust`, `font-size-adjust`], [`fontStretch`, `font-stretch`], [`fontStyle`, `font-style`], [`fontVariant`, `font-variant`], [`fontWeight`, `font-weight`], [`glyphName`, `glyph-name`], [`glyphOrientationHorizontal`, `glyph-orientation-horizontal`], [`glyphOrientationVertical`, `glyph-orientation-vertical`], [`horizAdvX`, `horiz-adv-x`], [`horizOriginX`, `horiz-origin-x`], [`imageRendering`, `image-rendering`], [`letterSpacing`, `letter-spacing`], [`lightingColor`, `lighting-color`], [`markerEnd`, `marker-end`], [`markerMid`, `marker-mid`], [`markerStart`, `marker-start`], [`overlinePosition`, `overline-position`], [`overlineThickness`, `overline-thickness`], [`paintOrder`, `paint-order`], [`panose-1`, `panose-1`], [`pointerEvents`, `pointer-events`], [`renderingIntent`, `rendering-intent`], [`shapeRendering`, `shape-rendering`], [`stopColor`, `stop-color`], [`stopOpacity`, `stop-opacity`], [`strikethroughPosition`, `strikethrough-position`], [`strikethroughThickness`, `strikethrough-thickness`], [`strokeDasharray`, `stroke-dasharray`], [`strokeDashoffset`, `stroke-dashoffset`], [`strokeLinecap`, `stroke-linecap`], [`strokeLinejoin`, `stroke-linejoin`], [`strokeMiterlimit`, `stroke-miterlimit`], [`strokeOpacity`, `stroke-opacity`], [`strokeWidth`, `stroke-width`], [`textAnchor`, `text-anchor`], [`textDecoration`, `text-decoration`], [`textRendering`, `text-rendering`], [`transformOrigin`, `transform-origin`], [`underlinePosition`, `underline-position`], [`underlineThickness`, `underline-thickness`], [`unicodeBidi`, `unicode-bidi`], [`unicodeRange`, `unicode-range`], [`unitsPerEm`, `units-per-em`], [`vAlphabetic`, `v-alphabetic`], [`vHanging`, `v-hanging`], [`vIdeographic`, `v-ideographic`], [`vMathematical`, `v-mathematical`], [`vectorEffect`, `vector-effect`], [`vertAdvY`, `vert-adv-y`], [`vertOriginX`, `vert-origin-x`], [`vertOriginY`, `vert-origin-y`], [`wordSpacing`, `word-spacing`], [`writingMode`, `writing-mode`], [`xmlnsXlink`, `xmlns:xlink`], [`xHeight`, `x-height`]]), tn2 = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function nn2(e3) {
    return tn2.test(`` + e3) ? `javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')` : e3;
  }
  var rn2 = null;
  function an2(e3) {
    return e3 = e3.target || e3.srcElement || window, e3.correspondingUseElement && (e3 = e3.correspondingUseElement), e3.nodeType === 3 ? e3.parentNode : e3;
  }
  var on2 = null, sn2 = null;
  function cn2(e3) {
    var t3 = _t2(e3);
    if (t3 && (e3 = t3.stateNode)) {
      var n3 = e3[ct2] || null;
      a: switch (e3 = t3.stateNode, t3.type) {
        case `input`:
          if (Gt2(e3, n3.value, n3.defaultValue, n3.defaultValue, n3.checked, n3.defaultChecked, n3.type, n3.name), t3 = n3.name, n3.type === `radio` && t3 != null) {
            for (n3 = e3; n3.parentNode; ) n3 = n3.parentNode;
            for (n3 = n3.querySelectorAll(`input[name="` + Wt2(`` + t3) + `"][type="radio"]`), t3 = 0; t3 < n3.length; t3++) {
              var r3 = n3[t3];
              if (r3 !== e3 && r3.form === e3.form) {
                var a3 = r3[ct2] || null;
                if (!a3) throw Error(i2(90));
                Gt2(r3, a3.value, a3.defaultValue, a3.defaultValue, a3.checked, a3.defaultChecked, a3.type, a3.name);
              }
            }
            for (t3 = 0; t3 < n3.length; t3++) r3 = n3[t3], r3.form === e3.form && Vt2(r3);
          }
          break a;
        case `textarea`:
          Jt2(e3, n3.value, n3.defaultValue);
          break a;
        case `select`:
          t3 = n3.value, t3 != null && qt2(e3, !!n3.multiple, t3, false);
      }
    }
  }
  var ln2 = false;
  function un2(e3, t3, n3) {
    if (ln2) return e3(t3, n3);
    ln2 = true;
    try {
      return e3(t3);
    } finally {
      if (ln2 = false, (on2 !== null || sn2 !== null) && (fu2(), on2 && (t3 = on2, e3 = sn2, sn2 = on2 = null, cn2(t3), e3))) for (t3 = 0; t3 < e3.length; t3++) cn2(e3[t3]);
    }
  }
  function dn2(e3, t3) {
    var n3 = e3.stateNode;
    if (n3 === null) return null;
    var r3 = n3[ct2] || null;
    if (r3 === null) return null;
    n3 = r3[t3];
    a: switch (t3) {
      case `onClick`:
      case `onClickCapture`:
      case `onDoubleClick`:
      case `onDoubleClickCapture`:
      case `onMouseDown`:
      case `onMouseDownCapture`:
      case `onMouseMove`:
      case `onMouseMoveCapture`:
      case `onMouseUp`:
      case `onMouseUpCapture`:
      case `onMouseEnter`:
        (r3 = !r3.disabled) || (e3 = e3.type, r3 = !(e3 === `button` || e3 === `input` || e3 === `select` || e3 === `textarea`)), e3 = !r3;
        break a;
      default:
        e3 = false;
    }
    if (e3) return null;
    if (n3 && typeof n3 != `function`) throw Error(i2(231, t3, typeof n3));
    return n3;
  }
  var fn2 = !(typeof window > `u` || window.document === void 0 || window.document.createElement === void 0), pn2 = false;
  if (fn2) try {
    var mn2 = {};
    Object.defineProperty(mn2, "passive", { get: function() {
      pn2 = true;
    } }), window.addEventListener(`test`, mn2, mn2), window.removeEventListener(`test`, mn2, mn2);
  } catch {
    pn2 = false;
  }
  var hn2 = null, P2 = null, gn2 = null;
  function _n2() {
    if (gn2) return gn2;
    var e3, t3 = P2, n3 = t3.length, r3, i3 = `value` in hn2 ? hn2.value : hn2.textContent, a3 = i3.length;
    for (e3 = 0; e3 < n3 && t3[e3] === i3[e3]; e3++) ;
    var o3 = n3 - e3;
    for (r3 = 1; r3 <= o3 && t3[n3 - r3] === i3[a3 - r3]; r3++) ;
    return gn2 = i3.slice(e3, 1 < r3 ? 1 - r3 : void 0);
  }
  function vn2(e3) {
    var t3 = e3.keyCode;
    return `charCode` in e3 ? (e3 = e3.charCode, e3 === 0 && t3 === 13 && (e3 = 13)) : e3 = t3, e3 === 10 && (e3 = 13), 32 <= e3 || e3 === 13 ? e3 : 0;
  }
  function yn2() {
    return true;
  }
  function bn2() {
    return false;
  }
  function xn2(e3) {
    function t3(t4, n3, r3, i3, a3) {
      for (var o3 in this._reactName = t4, this._targetInst = r3, this.type = n3, this.nativeEvent = i3, this.target = a3, this.currentTarget = null, e3) e3.hasOwnProperty(o3) && (t4 = e3[o3], this[o3] = t4 ? t4(i3) : i3[o3]);
      return this.isDefaultPrevented = (i3.defaultPrevented == null ? false === i3.returnValue : i3.defaultPrevented) ? yn2 : bn2, this.isPropagationStopped = bn2, this;
    }
    return d2(t3.prototype, { preventDefault: function() {
      this.defaultPrevented = true;
      var e4 = this.nativeEvent;
      e4 && (e4.preventDefault ? e4.preventDefault() : typeof e4.returnValue != `unknown` && (e4.returnValue = false), this.isDefaultPrevented = yn2);
    }, stopPropagation: function() {
      var e4 = this.nativeEvent;
      e4 && (e4.stopPropagation ? e4.stopPropagation() : typeof e4.cancelBubble != `unknown` && (e4.cancelBubble = true), this.isPropagationStopped = yn2);
    }, persist: function() {
    }, isPersistent: yn2 }), t3;
  }
  var Sn2 = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(e3) {
    return e3.timeStamp || Date.now();
  }, defaultPrevented: 0, isTrusted: 0 }, Cn2 = xn2(Sn2), wn2 = d2({}, Sn2, { view: 0, detail: 0 }), Tn2 = xn2(wn2), En2, Dn2, On2, kn2 = d2({}, wn2, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zn2, button: 0, buttons: 0, relatedTarget: function(e3) {
    return e3.relatedTarget === void 0 ? e3.fromElement === e3.srcElement ? e3.toElement : e3.fromElement : e3.relatedTarget;
  }, movementX: function(e3) {
    return `movementX` in e3 ? e3.movementX : (e3 !== On2 && (On2 && e3.type === `mousemove` ? (En2 = e3.screenX - On2.screenX, Dn2 = e3.screenY - On2.screenY) : Dn2 = En2 = 0, On2 = e3), En2);
  }, movementY: function(e3) {
    return `movementY` in e3 ? e3.movementY : Dn2;
  } }), An2 = xn2(kn2), jn2 = xn2(d2({}, kn2, { dataTransfer: 0 })), Mn2 = xn2(d2({}, wn2, { relatedTarget: 0 })), Nn2 = xn2(d2({}, Sn2, { animationName: 0, elapsedTime: 0, pseudoElement: 0 })), Pn2 = xn2(d2({}, Sn2, { clipboardData: function(e3) {
    return `clipboardData` in e3 ? e3.clipboardData : window.clipboardData;
  } })), F2 = xn2(d2({}, Sn2, { data: 0 })), Fn2 = { Esc: `Escape`, Spacebar: ` `, Left: `ArrowLeft`, Up: `ArrowUp`, Right: `ArrowRight`, Down: `ArrowDown`, Del: `Delete`, Win: `OS`, Menu: `ContextMenu`, Apps: `ContextMenu`, Scroll: `ScrollLock`, MozPrintableKey: `Unidentified` }, In2 = { 8: `Backspace`, 9: `Tab`, 12: `Clear`, 13: `Enter`, 16: `Shift`, 17: `Control`, 18: `Alt`, 19: `Pause`, 20: `CapsLock`, 27: `Escape`, 32: ` `, 33: `PageUp`, 34: `PageDown`, 35: `End`, 36: `Home`, 37: `ArrowLeft`, 38: `ArrowUp`, 39: `ArrowRight`, 40: `ArrowDown`, 45: `Insert`, 46: `Delete`, 112: `F1`, 113: `F2`, 114: `F3`, 115: `F4`, 116: `F5`, 117: `F6`, 118: `F7`, 119: `F8`, 120: `F9`, 121: `F10`, 122: `F11`, 123: `F12`, 144: `NumLock`, 145: `ScrollLock`, 224: `Meta` }, Ln2 = { Alt: `altKey`, Control: `ctrlKey`, Meta: `metaKey`, Shift: `shiftKey` };
  function Rn2(e3) {
    var t3 = this.nativeEvent;
    return t3.getModifierState ? t3.getModifierState(e3) : (e3 = Ln2[e3]) ? !!t3[e3] : false;
  }
  function zn2() {
    return Rn2;
  }
  var Bn2 = xn2(d2({}, wn2, { key: function(e3) {
    if (e3.key) {
      var t3 = Fn2[e3.key] || e3.key;
      if (t3 !== `Unidentified`) return t3;
    }
    return e3.type === `keypress` ? (e3 = vn2(e3), e3 === 13 ? `Enter` : String.fromCharCode(e3)) : e3.type === `keydown` || e3.type === `keyup` ? In2[e3.keyCode] || `Unidentified` : ``;
  }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zn2, charCode: function(e3) {
    return e3.type === `keypress` ? vn2(e3) : 0;
  }, keyCode: function(e3) {
    return e3.type === `keydown` || e3.type === `keyup` ? e3.keyCode : 0;
  }, which: function(e3) {
    return e3.type === `keypress` ? vn2(e3) : e3.type === `keydown` || e3.type === `keyup` ? e3.keyCode : 0;
  } })), Vn2 = xn2(d2({}, kn2, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 })), Hn2 = xn2(d2({}, wn2, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zn2 })), Un2 = xn2(d2({}, Sn2, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 })), Wn2 = xn2(d2({}, kn2, { deltaX: function(e3) {
    return `deltaX` in e3 ? e3.deltaX : `wheelDeltaX` in e3 ? -e3.wheelDeltaX : 0;
  }, deltaY: function(e3) {
    return `deltaY` in e3 ? e3.deltaY : `wheelDeltaY` in e3 ? -e3.wheelDeltaY : `wheelDelta` in e3 ? -e3.wheelDelta : 0;
  }, deltaZ: 0, deltaMode: 0 })), Gn2 = xn2(d2({}, Sn2, { newState: 0, oldState: 0 })), Kn2 = [9, 13, 27, 32], qn2 = fn2 && `CompositionEvent` in window, Jn2 = null;
  fn2 && `documentMode` in document && (Jn2 = document.documentMode);
  var Yn2 = fn2 && `TextEvent` in window && !Jn2, Xn2 = fn2 && (!qn2 || Jn2 && 8 < Jn2 && 11 >= Jn2), Zn2 = ` `, Qn2 = false;
  function $n2(e3, t3) {
    switch (e3) {
      case `keyup`:
        return Kn2.indexOf(t3.keyCode) !== -1;
      case `keydown`:
        return t3.keyCode !== 229;
      case `keypress`:
      case `mousedown`:
      case `focusout`:
        return true;
      default:
        return false;
    }
  }
  function er2(e3) {
    return e3 = e3.detail, typeof e3 == `object` && `data` in e3 ? e3.data : null;
  }
  var tr2 = false;
  function nr2(e3, t3) {
    switch (e3) {
      case `compositionend`:
        return er2(t3);
      case `keypress`:
        return t3.which === 32 ? (Qn2 = true, Zn2) : null;
      case `textInput`:
        return e3 = t3.data, e3 === Zn2 && Qn2 ? null : e3;
      default:
        return null;
    }
  }
  function rr2(e3, t3) {
    if (tr2) return e3 === `compositionend` || !qn2 && $n2(e3, t3) ? (e3 = _n2(), gn2 = P2 = hn2 = null, tr2 = false, e3) : null;
    switch (e3) {
      case `paste`:
        return null;
      case `keypress`:
        if (!(t3.ctrlKey || t3.altKey || t3.metaKey) || t3.ctrlKey && t3.altKey) {
          if (t3.char && 1 < t3.char.length) return t3.char;
          if (t3.which) return String.fromCharCode(t3.which);
        }
        return null;
      case `compositionend`:
        return Xn2 && t3.locale !== `ko` ? null : t3.data;
      default:
        return null;
    }
  }
  var ir2 = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
  function ar2(e3) {
    var t3 = e3 && e3.nodeName && e3.nodeName.toLowerCase();
    return t3 === `input` ? !!ir2[e3.type] : t3 === `textarea`;
  }
  function or2(e3, t3, n3, r3) {
    on2 ? sn2 ? sn2.push(r3) : sn2 = [r3] : on2 = r3, t3 = gd2(t3, `onChange`), 0 < t3.length && (n3 = new Cn2(`onChange`, `change`, null, n3, r3), e3.push({ event: n3, listeners: t3 }));
  }
  var sr2 = null, cr2 = null;
  function lr2(e3) {
    J2(e3, 0);
  }
  function ur2(e3) {
    if (Vt2(A2(e3))) return e3;
  }
  function dr2(e3, t3) {
    if (e3 === `change`) return t3;
  }
  var fr2 = false;
  if (fn2) {
    var pr2;
    if (fn2) {
      var mr2 = `oninput` in document;
      if (!mr2) {
        var hr2 = document.createElement(`div`);
        hr2.setAttribute(`oninput`, `return;`), mr2 = typeof hr2.oninput == `function`;
      }
      pr2 = mr2;
    } else pr2 = false;
    fr2 = pr2 && (!document.documentMode || 9 < document.documentMode);
  }
  function gr2() {
    sr2 && (sr2.detachEvent(`onpropertychange`, _r2), cr2 = sr2 = null);
  }
  function _r2(e3) {
    if (e3.propertyName === `value` && ur2(cr2)) {
      var t3 = [];
      or2(t3, cr2, e3, an2(e3)), un2(lr2, t3);
    }
  }
  function vr2(e3, t3, n3) {
    e3 === `focusin` ? (gr2(), sr2 = t3, cr2 = n3, sr2.attachEvent(`onpropertychange`, _r2)) : e3 === `focusout` && gr2();
  }
  function yr2(e3) {
    if (e3 === `selectionchange` || e3 === `keyup` || e3 === `keydown`) return ur2(cr2);
  }
  function br2(e3, t3) {
    if (e3 === `click`) return ur2(t3);
  }
  function xr2(e3, t3) {
    if (e3 === `input` || e3 === `change`) return ur2(t3);
  }
  function Sr2(e3, t3) {
    return e3 === t3 && (e3 !== 0 || 1 / e3 == 1 / t3) || e3 !== e3 && t3 !== t3;
  }
  var Cr2 = typeof Object.is == `function` ? Object.is : Sr2;
  function wr2(e3, t3) {
    if (Cr2(e3, t3)) return true;
    if (typeof e3 != `object` || !e3 || typeof t3 != `object` || !t3) return false;
    var n3 = Object.keys(e3), r3 = Object.keys(t3);
    if (n3.length !== r3.length) return false;
    for (r3 = 0; r3 < n3.length; r3++) {
      var i3 = n3[r3];
      if (!we2.call(t3, i3) || !Cr2(e3[i3], t3[i3])) return false;
    }
    return true;
  }
  function Tr2(e3) {
    for (; e3 && e3.firstChild; ) e3 = e3.firstChild;
    return e3;
  }
  function Er2(e3, t3) {
    var n3 = Tr2(e3);
    e3 = 0;
    for (var r3; n3; ) {
      if (n3.nodeType === 3) {
        if (r3 = e3 + n3.textContent.length, e3 <= t3 && r3 >= t3) return { node: n3, offset: t3 - e3 };
        e3 = r3;
      }
      a: {
        for (; n3; ) {
          if (n3.nextSibling) {
            n3 = n3.nextSibling;
            break a;
          }
          n3 = n3.parentNode;
        }
        n3 = void 0;
      }
      n3 = Tr2(n3);
    }
  }
  function Dr2(e3, t3) {
    return e3 && t3 ? e3 === t3 ? true : e3 && e3.nodeType === 3 ? false : t3 && t3.nodeType === 3 ? Dr2(e3, t3.parentNode) : `contains` in e3 ? e3.contains(t3) : e3.compareDocumentPosition ? !!(e3.compareDocumentPosition(t3) & 16) : false : false;
  }
  function Or2(e3) {
    e3 = e3 != null && e3.ownerDocument != null && e3.ownerDocument.defaultView != null ? e3.ownerDocument.defaultView : window;
    for (var t3 = Ht2(e3.document); t3 instanceof e3.HTMLIFrameElement; ) {
      try {
        var n3 = typeof t3.contentWindow.location.href == `string`;
      } catch {
        n3 = false;
      }
      if (n3) e3 = t3.contentWindow;
      else break;
      t3 = Ht2(e3.document);
    }
    return t3;
  }
  function kr2(e3) {
    var t3 = e3 && e3.nodeName && e3.nodeName.toLowerCase();
    return t3 && (t3 === `input` && (e3.type === `text` || e3.type === `search` || e3.type === `tel` || e3.type === `url` || e3.type === `password`) || t3 === `textarea` || e3.contentEditable === `true`);
  }
  var Ar2 = fn2 && `documentMode` in document && 11 >= document.documentMode, jr2 = null, Mr2 = null, Nr2 = null, Pr2 = false;
  function Fr2(e3, t3, n3) {
    var r3 = n3.window === n3 ? n3.document : n3.nodeType === 9 ? n3 : n3.ownerDocument;
    Pr2 || jr2 == null || jr2 !== Ht2(r3) || (r3 = jr2, `selectionStart` in r3 && kr2(r3) ? r3 = { start: r3.selectionStart, end: r3.selectionEnd } : (r3 = (r3.ownerDocument && r3.ownerDocument.defaultView || window).getSelection(), r3 = { anchorNode: r3.anchorNode, anchorOffset: r3.anchorOffset, focusNode: r3.focusNode, focusOffset: r3.focusOffset }), Nr2 && wr2(Nr2, r3) || (Nr2 = r3, r3 = gd2(Mr2, `onSelect`), 0 < r3.length && (t3 = new Cn2(`onSelect`, `select`, null, t3, n3), e3.push({ event: t3, listeners: r3 }), t3.target = jr2)));
  }
  function Ir2(e3, t3) {
    var n3 = {};
    return n3[e3.toLowerCase()] = t3.toLowerCase(), n3[`Webkit` + e3] = `webkit` + t3, n3[`Moz` + e3] = `moz` + t3, n3;
  }
  var Lr2 = { animationend: Ir2(`Animation`, `AnimationEnd`), animationiteration: Ir2(`Animation`, `AnimationIteration`), animationstart: Ir2(`Animation`, `AnimationStart`), transitionrun: Ir2(`Transition`, `TransitionRun`), transitionstart: Ir2(`Transition`, `TransitionStart`), transitioncancel: Ir2(`Transition`, `TransitionCancel`), transitionend: Ir2(`Transition`, `TransitionEnd`) }, Rr2 = {}, zr2 = {};
  fn2 && (zr2 = document.createElement(`div`).style, `AnimationEvent` in window || (delete Lr2.animationend.animation, delete Lr2.animationiteration.animation, delete Lr2.animationstart.animation), `TransitionEvent` in window || delete Lr2.transitionend.transition);
  function Br2(e3) {
    if (Rr2[e3]) return Rr2[e3];
    if (!Lr2[e3]) return e3;
    var t3 = Lr2[e3], n3;
    for (n3 in t3) if (t3.hasOwnProperty(n3) && n3 in zr2) return Rr2[e3] = t3[n3];
    return e3;
  }
  var Vr2 = Br2(`animationend`), Hr2 = Br2(`animationiteration`), Ur2 = Br2(`animationstart`), Wr2 = Br2(`transitionrun`), Gr2 = Br2(`transitionstart`), Kr2 = Br2(`transitioncancel`), qr2 = Br2(`transitionend`), Jr2 = /* @__PURE__ */ new Map(), Yr2 = `abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel`.split(` `);
  Yr2.push(`scrollEnd`);
  function Xr2(e3, t3) {
    Jr2.set(e3, t3), xt2(t3, [e3]);
  }
  var Zr2 = /* @__PURE__ */ new WeakMap();
  function Qr2(e3, t3) {
    if (typeof e3 == `object` && e3) {
      var n3 = Zr2.get(e3);
      return n3 === void 0 ? (t3 = { value: e3, source: t3, stack: It2(t3) }, Zr2.set(e3, t3), t3) : n3;
    }
    return { value: e3, source: t3, stack: It2(t3) };
  }
  var $r2 = [], ei2 = 0, ti2 = 0;
  function ni2() {
    for (var e3 = ei2, t3 = ti2 = ei2 = 0; t3 < e3; ) {
      var n3 = $r2[t3];
      $r2[t3++] = null;
      var r3 = $r2[t3];
      $r2[t3++] = null;
      var i3 = $r2[t3];
      $r2[t3++] = null;
      var a3 = $r2[t3];
      if ($r2[t3++] = null, r3 !== null && i3 !== null) {
        var o3 = r3.pending;
        o3 === null ? i3.next = i3 : (i3.next = o3.next, o3.next = i3), r3.pending = i3;
      }
      a3 !== 0 && oi2(n3, i3, a3);
    }
  }
  function ri2(e3, t3, n3, r3) {
    $r2[ei2++] = e3, $r2[ei2++] = t3, $r2[ei2++] = n3, $r2[ei2++] = r3, ti2 |= r3, e3.lanes |= r3, e3 = e3.alternate, e3 !== null && (e3.lanes |= r3);
  }
  function ii2(e3, t3, n3, r3) {
    return ri2(e3, t3, n3, r3), si2(e3);
  }
  function ai2(e3, t3) {
    return ri2(e3, null, null, t3), si2(e3);
  }
  function oi2(e3, t3, n3) {
    e3.lanes |= n3;
    var r3 = e3.alternate;
    r3 !== null && (r3.lanes |= n3);
    for (var i3 = false, a3 = e3.return; a3 !== null; ) a3.childLanes |= n3, r3 = a3.alternate, r3 !== null && (r3.childLanes |= n3), a3.tag === 22 && (e3 = a3.stateNode, e3 === null || e3._visibility & 1 || (i3 = true)), e3 = a3, a3 = a3.return;
    return e3.tag === 3 ? (a3 = e3.stateNode, i3 && t3 !== null && (i3 = 31 - k2(n3), e3 = a3.hiddenUpdates, r3 = e3[i3], r3 === null ? e3[i3] = [t3] : r3.push(t3), t3.lane = n3 | 536870912), a3) : null;
  }
  function si2(e3) {
    if (50 < ru2) throw ru2 = 0, iu2 = null, Error(i2(185));
    for (var t3 = e3.return; t3 !== null; ) e3 = t3, t3 = e3.return;
    return e3.tag === 3 ? e3.stateNode : null;
  }
  var ci2 = {};
  function li2(e3, t3, n3, r3) {
    this.tag = e3, this.key = n3, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t3, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r3, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
  }
  function ui2(e3, t3, n3, r3) {
    return new li2(e3, t3, n3, r3);
  }
  function di2(e3) {
    return e3 = e3.prototype, !(!e3 || !e3.isReactComponent);
  }
  function fi2(e3, t3) {
    var n3 = e3.alternate;
    return n3 === null ? (n3 = ui2(e3.tag, t3, e3.key, e3.mode), n3.elementType = e3.elementType, n3.type = e3.type, n3.stateNode = e3.stateNode, n3.alternate = e3, e3.alternate = n3) : (n3.pendingProps = t3, n3.type = e3.type, n3.flags = 0, n3.subtreeFlags = 0, n3.deletions = null), n3.flags = e3.flags & 65011712, n3.childLanes = e3.childLanes, n3.lanes = e3.lanes, n3.child = e3.child, n3.memoizedProps = e3.memoizedProps, n3.memoizedState = e3.memoizedState, n3.updateQueue = e3.updateQueue, t3 = e3.dependencies, n3.dependencies = t3 === null ? null : { lanes: t3.lanes, firstContext: t3.firstContext }, n3.sibling = e3.sibling, n3.index = e3.index, n3.ref = e3.ref, n3.refCleanup = e3.refCleanup, n3;
  }
  function pi2(e3, t3) {
    e3.flags &= 65011714;
    var n3 = e3.alternate;
    return n3 === null ? (e3.childLanes = 0, e3.lanes = t3, e3.child = null, e3.subtreeFlags = 0, e3.memoizedProps = null, e3.memoizedState = null, e3.updateQueue = null, e3.dependencies = null, e3.stateNode = null) : (e3.childLanes = n3.childLanes, e3.lanes = n3.lanes, e3.child = n3.child, e3.subtreeFlags = 0, e3.deletions = null, e3.memoizedProps = n3.memoizedProps, e3.memoizedState = n3.memoizedState, e3.updateQueue = n3.updateQueue, e3.type = n3.type, t3 = n3.dependencies, e3.dependencies = t3 === null ? null : { lanes: t3.lanes, firstContext: t3.firstContext }), e3;
  }
  function mi2(e3, t3, n3, r3, a3, o3) {
    var s3 = 0;
    if (r3 = e3, typeof e3 == `function`) di2(e3) && (s3 = 1);
    else if (typeof e3 == `string`) s3 = Of2(e3, n3, pe2.current) ? 26 : e3 === `html` || e3 === `head` || e3 === `body` ? 27 : 5;
    else a: switch (e3) {
      case ne2:
        return e3 = ui2(31, n3, t3, a3), e3.elementType = ne2, e3.lanes = o3, e3;
      case h2:
        return hi2(n3.children, a3, o3, t3);
      case g2:
        s3 = 8, a3 |= 24;
        break;
      case _2:
        return e3 = ui2(12, n3, t3, a3 | 2), e3.elementType = _2, e3.lanes = o3, e3;
      case S2:
        return e3 = ui2(13, n3, t3, a3), e3.elementType = S2, e3.lanes = o3, e3;
      case C2:
        return e3 = ui2(19, n3, t3, a3), e3.elementType = C2, e3.lanes = o3, e3;
      default:
        if (typeof e3 == `object` && e3) switch (e3.$$typeof) {
          case v2:
          case b2:
            s3 = 10;
            break a;
          case y2:
            s3 = 9;
            break a;
          case x2:
            s3 = 11;
            break a;
          case ee2:
            s3 = 14;
            break a;
          case te2:
            s3 = 16, r3 = null;
            break a;
        }
        s3 = 29, n3 = Error(i2(130, e3 === null ? `null` : typeof e3, ``)), r3 = null;
    }
    return t3 = ui2(s3, n3, t3, a3), t3.elementType = e3, t3.type = r3, t3.lanes = o3, t3;
  }
  function hi2(e3, t3, n3, r3) {
    return e3 = ui2(7, e3, r3, t3), e3.lanes = n3, e3;
  }
  function gi2(e3, t3, n3) {
    return e3 = ui2(6, e3, null, t3), e3.lanes = n3, e3;
  }
  function _i2(e3, t3, n3) {
    return t3 = ui2(4, e3.children === null ? [] : e3.children, e3.key, t3), t3.lanes = n3, t3.stateNode = { containerInfo: e3.containerInfo, pendingChildren: null, implementation: e3.implementation }, t3;
  }
  var vi2 = [], yi2 = 0, bi2 = null, xi2 = 0, Si2 = [], Ci2 = 0, wi2 = null, Ti2 = 1, Ei2 = ``;
  function Di2(e3, t3) {
    vi2[yi2++] = xi2, vi2[yi2++] = bi2, bi2 = e3, xi2 = t3;
  }
  function Oi2(e3, t3, n3) {
    Si2[Ci2++] = Ti2, Si2[Ci2++] = Ei2, Si2[Ci2++] = wi2, wi2 = e3;
    var r3 = Ti2;
    e3 = Ei2;
    var i3 = 32 - k2(r3) - 1;
    r3 &= ~(1 << i3), n3 += 1;
    var a3 = 32 - k2(t3) + i3;
    if (30 < a3) {
      var o3 = i3 - i3 % 5;
      a3 = (r3 & (1 << o3) - 1).toString(32), r3 >>= o3, i3 -= o3, Ti2 = 1 << 32 - k2(t3) + i3 | n3 << i3 | r3, Ei2 = a3 + e3;
    } else Ti2 = 1 << a3 | n3 << i3 | r3, Ei2 = e3;
  }
  function ki2(e3) {
    e3.return !== null && (Di2(e3, 1), Oi2(e3, 1, 0));
  }
  function Ai2(e3) {
    for (; e3 === bi2; ) bi2 = vi2[--yi2], vi2[yi2] = null, xi2 = vi2[--yi2], vi2[yi2] = null;
    for (; e3 === wi2; ) wi2 = Si2[--Ci2], Si2[Ci2] = null, Ei2 = Si2[--Ci2], Si2[Ci2] = null, Ti2 = Si2[--Ci2], Si2[Ci2] = null;
  }
  var ji2 = null, Mi2 = null, I2 = false, Ni2 = null, Pi2 = false, Fi2 = Error(i2(519));
  function Ii2(e3) {
    throw Hi2(Qr2(Error(i2(418, ``)), e3)), Fi2;
  }
  function Li2(e3) {
    var t3 = e3.stateNode, n3 = e3.type, r3 = e3.memoizedProps;
    switch (t3[st2] = e3, t3[ct2] = r3, n3) {
      case `dialog`:
        Y2(`cancel`, t3), Y2(`close`, t3);
        break;
      case `iframe`:
      case `object`:
      case `embed`:
        Y2(`load`, t3);
        break;
      case `video`:
      case `audio`:
        for (n3 = 0; n3 < cd2.length; n3++) Y2(cd2[n3], t3);
        break;
      case `source`:
        Y2(`error`, t3);
        break;
      case `img`:
      case `image`:
      case `link`:
        Y2(`error`, t3), Y2(`load`, t3);
        break;
      case `details`:
        Y2(`toggle`, t3);
        break;
      case `input`:
        Y2(`invalid`, t3), M2(t3, r3.value, r3.defaultValue, r3.checked, r3.defaultChecked, r3.type, r3.name, true), Bt2(t3);
        break;
      case `select`:
        Y2(`invalid`, t3);
        break;
      case `textarea`:
        Y2(`invalid`, t3), Yt2(t3, r3.value, r3.defaultValue, r3.children), Bt2(t3);
    }
    n3 = r3.children, typeof n3 != `string` && typeof n3 != `number` && typeof n3 != `bigint` || t3.textContent === `` + n3 || true === r3.suppressHydrationWarning || Sd2(t3.textContent, n3) ? (r3.popover != null && (Y2(`beforetoggle`, t3), Y2(`toggle`, t3)), r3.onScroll != null && Y2(`scroll`, t3), r3.onScrollEnd != null && Y2(`scrollend`, t3), r3.onClick != null && (t3.onclick = Cd2), t3 = true) : t3 = false, t3 || Ii2(e3);
  }
  function Ri2(e3) {
    for (ji2 = e3.return; ji2; ) switch (ji2.tag) {
      case 5:
      case 13:
        Pi2 = false;
        return;
      case 27:
      case 3:
        Pi2 = true;
        return;
      default:
        ji2 = ji2.return;
    }
  }
  function zi2(e3) {
    if (e3 !== ji2) return false;
    if (!I2) return Ri2(e3), I2 = true, false;
    var t3 = e3.tag, n3;
    if ((n3 = t3 !== 3 && t3 !== 27) && ((n3 = t3 === 5) && (n3 = e3.type, n3 = !(n3 !== `form` && n3 !== `button`) || Md2(e3.type, e3.memoizedProps)), n3 = !n3), n3 && Mi2 && Ii2(e3), Ri2(e3), t3 === 13) {
      if (e3 = e3.memoizedState, e3 = e3 === null ? null : e3.dehydrated, !e3) throw Error(i2(317));
      a: {
        for (e3 = e3.nextSibling, t3 = 0; e3; ) {
          if (e3.nodeType === 8) if (n3 = e3.data, n3 === `/$`) {
            if (t3 === 0) {
              Mi2 = qd2(e3.nextSibling);
              break a;
            }
            t3--;
          } else n3 !== `$` && n3 !== `$!` && n3 !== `$?` || t3++;
          e3 = e3.nextSibling;
        }
        Mi2 = null;
      }
    } else t3 === 27 ? (t3 = Mi2, Bd2(e3.type) ? (e3 = Jd2, Jd2 = null, Mi2 = e3) : Mi2 = t3) : Mi2 = ji2 ? qd2(e3.stateNode.nextSibling) : null;
    return true;
  }
  function Bi2() {
    Mi2 = ji2 = null, I2 = false;
  }
  function Vi2() {
    var e3 = Ni2;
    return e3 !== null && (Wl2 === null ? Wl2 = e3 : Wl2.push.apply(Wl2, e3), Ni2 = null), e3;
  }
  function Hi2(e3) {
    Ni2 === null ? Ni2 = [e3] : Ni2.push(e3);
  }
  var Ui2 = E2(null), Wi2 = null, Gi2 = null;
  function Ki2(e3, t3, n3) {
    D2(Ui2, t3._currentValue), t3._currentValue = n3;
  }
  function qi2(e3) {
    e3._currentValue = Ui2.current, fe2(Ui2);
  }
  function Ji2(e3, t3, n3) {
    for (; e3 !== null; ) {
      var r3 = e3.alternate;
      if ((e3.childLanes & t3) === t3 ? r3 !== null && (r3.childLanes & t3) !== t3 && (r3.childLanes |= t3) : (e3.childLanes |= t3, r3 !== null && (r3.childLanes |= t3)), e3 === n3) break;
      e3 = e3.return;
    }
  }
  function Yi2(e3, t3, n3, r3) {
    var a3 = e3.child;
    for (a3 !== null && (a3.return = e3); a3 !== null; ) {
      var o3 = a3.dependencies;
      if (o3 !== null) {
        var s3 = a3.child;
        o3 = o3.firstContext;
        a: for (; o3 !== null; ) {
          var c3 = o3;
          o3 = a3;
          for (var l3 = 0; l3 < t3.length; l3++) if (c3.context === t3[l3]) {
            o3.lanes |= n3, c3 = o3.alternate, c3 !== null && (c3.lanes |= n3), Ji2(o3.return, n3, e3), r3 || (s3 = null);
            break a;
          }
          o3 = c3.next;
        }
      } else if (a3.tag === 18) {
        if (s3 = a3.return, s3 === null) throw Error(i2(341));
        s3.lanes |= n3, o3 = s3.alternate, o3 !== null && (o3.lanes |= n3), Ji2(s3, n3, e3), s3 = null;
      } else s3 = a3.child;
      if (s3 !== null) s3.return = a3;
      else for (s3 = a3; s3 !== null; ) {
        if (s3 === e3) {
          s3 = null;
          break;
        }
        if (a3 = s3.sibling, a3 !== null) {
          a3.return = s3.return, s3 = a3;
          break;
        }
        s3 = s3.return;
      }
      a3 = s3;
    }
  }
  function Xi2(e3, t3, n3, r3) {
    e3 = null;
    for (var a3 = t3, o3 = false; a3 !== null; ) {
      if (!o3) {
        if (a3.flags & 524288) o3 = true;
        else if (a3.flags & 262144) break;
      }
      if (a3.tag === 10) {
        var s3 = a3.alternate;
        if (s3 === null) throw Error(i2(387));
        if (s3 = s3.memoizedProps, s3 !== null) {
          var c3 = a3.type;
          Cr2(a3.pendingProps.value, s3.value) || (e3 === null ? e3 = [c3] : e3.push(c3));
        }
      } else if (a3 === ge2.current) {
        if (s3 = a3.alternate, s3 === null) throw Error(i2(387));
        s3.memoizedState.memoizedState !== a3.memoizedState.memoizedState && (e3 === null ? e3 = [Rf2] : e3.push(Rf2));
      }
      a3 = a3.return;
    }
    e3 !== null && Yi2(t3, e3, n3, r3), t3.flags |= 262144;
  }
  function Zi2(e3) {
    for (e3 = e3.firstContext; e3 !== null; ) {
      if (!Cr2(e3.context._currentValue, e3.memoizedValue)) return true;
      e3 = e3.next;
    }
    return false;
  }
  function Qi2(e3) {
    Wi2 = e3, Gi2 = null, e3 = e3.dependencies, e3 !== null && (e3.firstContext = null);
  }
  function $i2(e3) {
    return ta2(Wi2, e3);
  }
  function ea2(e3, t3) {
    return Wi2 === null && Qi2(e3), ta2(e3, t3);
  }
  function ta2(e3, t3) {
    var n3 = t3._currentValue;
    if (t3 = { context: t3, memoizedValue: n3, next: null }, Gi2 === null) {
      if (e3 === null) throw Error(i2(308));
      Gi2 = t3, e3.dependencies = { lanes: 0, firstContext: t3 }, e3.flags |= 524288;
    } else Gi2 = Gi2.next = t3;
    return n3;
  }
  var na2 = typeof AbortController < `u` ? AbortController : function() {
    var e3 = [], t3 = this.signal = { aborted: false, addEventListener: function(t4, n3) {
      e3.push(n3);
    } };
    this.abort = function() {
      t3.aborted = true, e3.forEach(function(e4) {
        return e4();
      });
    };
  }, ra2 = t2.unstable_scheduleCallback, ia2 = t2.unstable_NormalPriority, aa2 = { $$typeof: b2, Consumer: null, Provider: null, _currentValue: null, _currentValue2: null, _threadCount: 0 };
  function oa2() {
    return { controller: new na2(), data: /* @__PURE__ */ new Map(), refCount: 0 };
  }
  function sa2(e3) {
    e3.refCount--, e3.refCount === 0 && ra2(ia2, function() {
      e3.controller.abort();
    });
  }
  var ca2 = null, la2 = 0, ua2 = 0, da2 = null;
  function fa2(e3, t3) {
    if (ca2 === null) {
      var n3 = ca2 = [];
      la2 = 0, ua2 = nd2(), da2 = { status: `pending`, value: void 0, then: function(e4) {
        n3.push(e4);
      } };
    }
    return la2++, t3.then(pa2, pa2), t3;
  }
  function pa2() {
    if (--la2 === 0 && ca2 !== null) {
      da2 !== null && (da2.status = `fulfilled`);
      var e3 = ca2;
      ca2 = null, ua2 = 0, da2 = null;
      for (var t3 = 0; t3 < e3.length; t3++) (0, e3[t3])();
    }
  }
  function ma2(e3, t3) {
    var n3 = [], r3 = { status: `pending`, value: null, reason: null, then: function(e4) {
      n3.push(e4);
    } };
    return e3.then(function() {
      r3.status = `fulfilled`, r3.value = t3;
      for (var e4 = 0; e4 < n3.length; e4++) (0, n3[e4])(t3);
    }, function(e4) {
      for (r3.status = `rejected`, r3.reason = e4, e4 = 0; e4 < n3.length; e4++) (0, n3[e4])(void 0);
    }), r3;
  }
  var ha2 = w2.S;
  w2.S = function(e3, t3) {
    typeof t3 == `object` && t3 && typeof t3.then == `function` && fa2(e3, t3), ha2 !== null && ha2(e3, t3);
  };
  var ga2 = E2(null);
  function _a2() {
    var e3 = ga2.current;
    return e3 === null ? U2.pooledCache : e3;
  }
  function va2(e3, t3) {
    t3 === null ? D2(ga2, ga2.current) : D2(ga2, t3.pool);
  }
  function ya2() {
    var e3 = _a2();
    return e3 === null ? null : { parent: aa2._currentValue, pool: e3 };
  }
  var ba2 = Error(i2(460)), xa2 = Error(i2(474)), Sa2 = Error(i2(542)), Ca2 = { then: function() {
  } };
  function wa2(e3) {
    return e3 = e3.status, e3 === `fulfilled` || e3 === `rejected`;
  }
  function Ta2() {
  }
  function Ea2(e3, t3, n3) {
    switch (n3 = e3[n3], n3 === void 0 ? e3.push(t3) : n3 !== t3 && (t3.then(Ta2, Ta2), t3 = n3), t3.status) {
      case `fulfilled`:
        return t3.value;
      case `rejected`:
        throw e3 = t3.reason, ka2(e3), e3;
      default:
        if (typeof t3.status == `string`) t3.then(Ta2, Ta2);
        else {
          if (e3 = U2, e3 !== null && 100 < e3.shellSuspendCounter) throw Error(i2(482));
          e3 = t3, e3.status = `pending`, e3.then(function(e4) {
            if (t3.status === `pending`) {
              var n4 = t3;
              n4.status = `fulfilled`, n4.value = e4;
            }
          }, function(e4) {
            if (t3.status === `pending`) {
              var n4 = t3;
              n4.status = `rejected`, n4.reason = e4;
            }
          });
        }
        switch (t3.status) {
          case `fulfilled`:
            return t3.value;
          case `rejected`:
            throw e3 = t3.reason, ka2(e3), e3;
        }
        throw Da2 = t3, ba2;
    }
  }
  var Da2 = null;
  function Oa2() {
    if (Da2 === null) throw Error(i2(459));
    var e3 = Da2;
    return Da2 = null, e3;
  }
  function ka2(e3) {
    if (e3 === ba2 || e3 === Sa2) throw Error(i2(483));
  }
  var Aa2 = false;
  function ja2(e3) {
    e3.updateQueue = { baseState: e3.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, lanes: 0, hiddenCallbacks: null }, callbacks: null };
  }
  function Ma2(e3, t3) {
    e3 = e3.updateQueue, t3.updateQueue === e3 && (t3.updateQueue = { baseState: e3.baseState, firstBaseUpdate: e3.firstBaseUpdate, lastBaseUpdate: e3.lastBaseUpdate, shared: e3.shared, callbacks: null });
  }
  function Na2(e3) {
    return { lane: e3, tag: 0, payload: null, callback: null, next: null };
  }
  function Pa2(e3, t3, n3) {
    var r3 = e3.updateQueue;
    if (r3 === null) return null;
    if (r3 = r3.shared, H2 & 2) {
      var i3 = r3.pending;
      return i3 === null ? t3.next = t3 : (t3.next = i3.next, i3.next = t3), r3.pending = t3, t3 = si2(e3), oi2(e3, null, n3), t3;
    }
    return ri2(e3, r3, t3, n3), si2(e3);
  }
  function Fa2(e3, t3, n3) {
    if (t3 = t3.updateQueue, t3 !== null && (t3 = t3.shared, n3 & 4194048)) {
      var r3 = t3.lanes;
      r3 &= e3.pendingLanes, n3 |= r3, t3.lanes = n3, tt2(e3, n3);
    }
  }
  function Ia2(e3, t3) {
    var n3 = e3.updateQueue, r3 = e3.alternate;
    if (r3 !== null && (r3 = r3.updateQueue, n3 === r3)) {
      var i3 = null, a3 = null;
      if (n3 = n3.firstBaseUpdate, n3 !== null) {
        do {
          var o3 = { lane: n3.lane, tag: n3.tag, payload: n3.payload, callback: null, next: null };
          a3 === null ? i3 = a3 = o3 : a3 = a3.next = o3, n3 = n3.next;
        } while (n3 !== null);
        a3 === null ? i3 = a3 = t3 : a3 = a3.next = t3;
      } else i3 = a3 = t3;
      n3 = { baseState: r3.baseState, firstBaseUpdate: i3, lastBaseUpdate: a3, shared: r3.shared, callbacks: r3.callbacks }, e3.updateQueue = n3;
      return;
    }
    e3 = n3.lastBaseUpdate, e3 === null ? n3.firstBaseUpdate = t3 : e3.next = t3, n3.lastBaseUpdate = t3;
  }
  var La2 = false;
  function Ra2() {
    if (La2) {
      var e3 = da2;
      if (e3 !== null) throw e3;
    }
  }
  function za2(e3, t3, n3, r3) {
    La2 = false;
    var i3 = e3.updateQueue;
    Aa2 = false;
    var a3 = i3.firstBaseUpdate, o3 = i3.lastBaseUpdate, s3 = i3.shared.pending;
    if (s3 !== null) {
      i3.shared.pending = null;
      var c3 = s3, l3 = c3.next;
      c3.next = null, o3 === null ? a3 = l3 : o3.next = l3, o3 = c3;
      var u3 = e3.alternate;
      u3 !== null && (u3 = u3.updateQueue, s3 = u3.lastBaseUpdate, s3 !== o3 && (s3 === null ? u3.firstBaseUpdate = l3 : s3.next = l3, u3.lastBaseUpdate = c3));
    }
    if (a3 !== null) {
      var f3 = i3.baseState;
      o3 = 0, u3 = l3 = c3 = null, s3 = a3;
      do {
        var p3 = s3.lane & -536870913, m3 = p3 !== s3.lane;
        if (m3 ? (G2 & p3) === p3 : (r3 & p3) === p3) {
          p3 !== 0 && p3 === ua2 && (La2 = true), u3 !== null && (u3 = u3.next = { lane: 0, tag: s3.tag, payload: s3.payload, callback: null, next: null });
          a: {
            var h3 = e3, g3 = s3;
            p3 = t3;
            var _3 = n3;
            switch (g3.tag) {
              case 1:
                if (h3 = g3.payload, typeof h3 == `function`) {
                  f3 = h3.call(_3, f3, p3);
                  break a;
                }
                f3 = h3;
                break a;
              case 3:
                h3.flags = h3.flags & -65537 | 128;
              case 0:
                if (h3 = g3.payload, p3 = typeof h3 == `function` ? h3.call(_3, f3, p3) : h3, p3 == null) break a;
                f3 = d2({}, f3, p3);
                break a;
              case 2:
                Aa2 = true;
            }
          }
          p3 = s3.callback, p3 !== null && (e3.flags |= 64, m3 && (e3.flags |= 8192), m3 = i3.callbacks, m3 === null ? i3.callbacks = [p3] : m3.push(p3));
        } else m3 = { lane: p3, tag: s3.tag, payload: s3.payload, callback: s3.callback, next: null }, u3 === null ? (l3 = u3 = m3, c3 = f3) : u3 = u3.next = m3, o3 |= p3;
        if (s3 = s3.next, s3 === null) {
          if (s3 = i3.shared.pending, s3 === null) break;
          m3 = s3, s3 = m3.next, m3.next = null, i3.lastBaseUpdate = m3, i3.shared.pending = null;
        }
      } while (1);
      u3 === null && (c3 = f3), i3.baseState = c3, i3.firstBaseUpdate = l3, i3.lastBaseUpdate = u3, a3 === null && (i3.shared.lanes = 0), Rl2 |= o3, e3.lanes = o3, e3.memoizedState = f3;
    }
  }
  function Ba2(e3, t3) {
    if (typeof e3 != `function`) throw Error(i2(191, e3));
    e3.call(t3);
  }
  function Va2(e3, t3) {
    var n3 = e3.callbacks;
    if (n3 !== null) for (e3.callbacks = null, e3 = 0; e3 < n3.length; e3++) Ba2(n3[e3], t3);
  }
  var Ha2 = E2(null), Ua2 = E2(0);
  function Wa2(e3, t3) {
    e3 = Il2, D2(Ua2, e3), D2(Ha2, t3), Il2 = e3 | t3.baseLanes;
  }
  function Ga2() {
    D2(Ua2, Il2), D2(Ha2, Ha2.current);
  }
  function Ka2() {
    Il2 = Ua2.current, fe2(Ha2), fe2(Ua2);
  }
  var qa2 = 0, L2 = null, R2 = null, z2 = null, Ja2 = false, Ya2 = false, Xa2 = false, Za2 = 0, Qa2 = 0, $a2 = null, eo2 = 0;
  function to2() {
    throw Error(i2(321));
  }
  function no2(e3, t3) {
    if (t3 === null) return false;
    for (var n3 = 0; n3 < t3.length && n3 < e3.length; n3++) if (!Cr2(e3[n3], t3[n3])) return false;
    return true;
  }
  function ro2(e3, t3, n3, r3, i3, a3) {
    return qa2 = a3, L2 = t3, t3.memoizedState = null, t3.updateQueue = null, t3.lanes = 0, w2.H = e3 === null || e3.memoizedState === null ? bs2 : xs2, Xa2 = false, a3 = n3(r3, i3), Xa2 = false, Ya2 && (a3 = ao2(t3, n3, r3, i3)), io2(e3), a3;
  }
  function io2(e3) {
    w2.H = ys2;
    var t3 = R2 !== null && R2.next !== null;
    if (qa2 = 0, z2 = R2 = L2 = null, Ja2 = false, Qa2 = 0, $a2 = null, t3) throw Error(i2(300));
    e3 === null || tc2 || (e3 = e3.dependencies, e3 !== null && Zi2(e3) && (tc2 = true));
  }
  function ao2(e3, t3, n3, r3) {
    L2 = e3;
    var a3 = 0;
    do {
      if (Ya2 && ($a2 = null), Qa2 = 0, Ya2 = false, 25 <= a3) throw Error(i2(301));
      if (a3 += 1, z2 = R2 = null, e3.updateQueue != null) {
        var o3 = e3.updateQueue;
        o3.lastEffect = null, o3.events = null, o3.stores = null, o3.memoCache != null && (o3.memoCache.index = 0);
      }
      w2.H = Ss2, o3 = t3(n3, r3);
    } while (Ya2);
    return o3;
  }
  function oo2() {
    var e3 = w2.H, t3 = e3.useState()[0];
    return t3 = typeof t3.then == `function` ? mo2(t3) : t3, e3 = e3.useState()[0], (R2 === null ? null : R2.memoizedState) !== e3 && (L2.flags |= 1024), t3;
  }
  function so2() {
    var e3 = Za2 !== 0;
    return Za2 = 0, e3;
  }
  function co2(e3, t3, n3) {
    t3.updateQueue = e3.updateQueue, t3.flags &= -2053, e3.lanes &= ~n3;
  }
  function lo2(e3) {
    if (Ja2) {
      for (e3 = e3.memoizedState; e3 !== null; ) {
        var t3 = e3.queue;
        t3 !== null && (t3.pending = null), e3 = e3.next;
      }
      Ja2 = false;
    }
    qa2 = 0, z2 = R2 = L2 = null, Ya2 = false, Qa2 = Za2 = 0, $a2 = null;
  }
  function uo2() {
    var e3 = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
    return z2 === null ? L2.memoizedState = z2 = e3 : z2 = z2.next = e3, z2;
  }
  function fo2() {
    if (R2 === null) {
      var e3 = L2.alternate;
      e3 = e3 === null ? null : e3.memoizedState;
    } else e3 = R2.next;
    var t3 = z2 === null ? L2.memoizedState : z2.next;
    if (t3 !== null) z2 = t3, R2 = e3;
    else {
      if (e3 === null) throw L2.alternate === null ? Error(i2(467)) : Error(i2(310));
      R2 = e3, e3 = { memoizedState: R2.memoizedState, baseState: R2.baseState, baseQueue: R2.baseQueue, queue: R2.queue, next: null }, z2 === null ? L2.memoizedState = z2 = e3 : z2 = z2.next = e3;
    }
    return z2;
  }
  function po2() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function mo2(e3) {
    var t3 = Qa2;
    return Qa2 += 1, $a2 === null && ($a2 = []), e3 = Ea2($a2, e3, t3), t3 = L2, (z2 === null ? t3.memoizedState : z2.next) === null && (t3 = t3.alternate, w2.H = t3 === null || t3.memoizedState === null ? bs2 : xs2), e3;
  }
  function ho2(e3) {
    if (typeof e3 == `object` && e3) {
      if (typeof e3.then == `function`) return mo2(e3);
      if (e3.$$typeof === b2) return $i2(e3);
    }
    throw Error(i2(438, String(e3)));
  }
  function go2(e3) {
    var t3 = null, n3 = L2.updateQueue;
    if (n3 !== null && (t3 = n3.memoCache), t3 == null) {
      var r3 = L2.alternate;
      r3 !== null && (r3 = r3.updateQueue, r3 !== null && (r3 = r3.memoCache, r3 != null && (t3 = { data: r3.data.map(function(e4) {
        return e4.slice();
      }), index: 0 })));
    }
    if (t3 ??= { data: [], index: 0 }, n3 === null && (n3 = po2(), L2.updateQueue = n3), n3.memoCache = t3, n3 = t3.data[t3.index], n3 === void 0) for (n3 = t3.data[t3.index] = Array(e3), r3 = 0; r3 < e3; r3++) n3[r3] = re2;
    return t3.index++, n3;
  }
  function _o2(e3, t3) {
    return typeof t3 == `function` ? t3(e3) : t3;
  }
  function vo2(e3) {
    return yo2(fo2(), R2, e3);
  }
  function yo2(e3, t3, n3) {
    var r3 = e3.queue;
    if (r3 === null) throw Error(i2(311));
    r3.lastRenderedReducer = n3;
    var a3 = e3.baseQueue, o3 = r3.pending;
    if (o3 !== null) {
      if (a3 !== null) {
        var s3 = a3.next;
        a3.next = o3.next, o3.next = s3;
      }
      t3.baseQueue = a3 = o3, r3.pending = null;
    }
    if (o3 = e3.baseState, a3 === null) e3.memoizedState = o3;
    else {
      t3 = a3.next;
      var c3 = s3 = null, l3 = null, u3 = t3, d3 = false;
      do {
        var f3 = u3.lane & -536870913;
        if (f3 === u3.lane ? (qa2 & f3) === f3 : (G2 & f3) === f3) {
          var p3 = u3.revertLane;
          if (p3 === 0) l3 !== null && (l3 = l3.next = { lane: 0, revertLane: 0, action: u3.action, hasEagerState: u3.hasEagerState, eagerState: u3.eagerState, next: null }), f3 === ua2 && (d3 = true);
          else if ((qa2 & p3) === p3) {
            u3 = u3.next, p3 === ua2 && (d3 = true);
            continue;
          } else f3 = { lane: 0, revertLane: u3.revertLane, action: u3.action, hasEagerState: u3.hasEagerState, eagerState: u3.eagerState, next: null }, l3 === null ? (c3 = l3 = f3, s3 = o3) : l3 = l3.next = f3, L2.lanes |= p3, Rl2 |= p3;
          f3 = u3.action, Xa2 && n3(o3, f3), o3 = u3.hasEagerState ? u3.eagerState : n3(o3, f3);
        } else p3 = { lane: f3, revertLane: u3.revertLane, action: u3.action, hasEagerState: u3.hasEagerState, eagerState: u3.eagerState, next: null }, l3 === null ? (c3 = l3 = p3, s3 = o3) : l3 = l3.next = p3, L2.lanes |= f3, Rl2 |= f3;
        u3 = u3.next;
      } while (u3 !== null && u3 !== t3);
      if (l3 === null ? s3 = o3 : l3.next = c3, !Cr2(o3, e3.memoizedState) && (tc2 = true, d3 && (n3 = da2, n3 !== null))) throw n3;
      e3.memoizedState = o3, e3.baseState = s3, e3.baseQueue = l3, r3.lastRenderedState = o3;
    }
    return a3 === null && (r3.lanes = 0), [e3.memoizedState, r3.dispatch];
  }
  function bo2(e3) {
    var t3 = fo2(), n3 = t3.queue;
    if (n3 === null) throw Error(i2(311));
    n3.lastRenderedReducer = e3;
    var r3 = n3.dispatch, a3 = n3.pending, o3 = t3.memoizedState;
    if (a3 !== null) {
      n3.pending = null;
      var s3 = a3 = a3.next;
      do
        o3 = e3(o3, s3.action), s3 = s3.next;
      while (s3 !== a3);
      Cr2(o3, t3.memoizedState) || (tc2 = true), t3.memoizedState = o3, t3.baseQueue === null && (t3.baseState = o3), n3.lastRenderedState = o3;
    }
    return [o3, r3];
  }
  function xo2(e3, t3, n3) {
    var r3 = L2, a3 = fo2(), o3 = I2;
    if (o3) {
      if (n3 === void 0) throw Error(i2(407));
      n3 = n3();
    } else n3 = t3();
    var s3 = !Cr2((R2 || a3).memoizedState, n3);
    if (s3 && (a3.memoizedState = n3, tc2 = true), a3 = a3.queue, Go2(2048, 8, wo2.bind(null, r3, a3, e3), [e3]), a3.getSnapshot !== t3 || s3 || z2 !== null && z2.memoizedState.tag & 1) {
      if (r3.flags |= 2048, Vo2(9, Ho2(), Co2.bind(null, r3, a3, n3, t3), null), U2 === null) throw Error(i2(349));
      o3 || qa2 & 124 || So2(r3, t3, n3);
    }
    return n3;
  }
  function So2(e3, t3, n3) {
    e3.flags |= 16384, e3 = { getSnapshot: t3, value: n3 }, t3 = L2.updateQueue, t3 === null ? (t3 = po2(), L2.updateQueue = t3, t3.stores = [e3]) : (n3 = t3.stores, n3 === null ? t3.stores = [e3] : n3.push(e3));
  }
  function Co2(e3, t3, n3, r3) {
    t3.value = n3, t3.getSnapshot = r3, To2(t3) && Eo2(e3);
  }
  function wo2(e3, t3, n3) {
    return n3(function() {
      To2(t3) && Eo2(e3);
    });
  }
  function To2(e3) {
    var t3 = e3.getSnapshot;
    e3 = e3.value;
    try {
      var n3 = t3();
      return !Cr2(e3, n3);
    } catch {
      return true;
    }
  }
  function Eo2(e3) {
    var t3 = ai2(e3, 2);
    t3 !== null && su2(t3, e3, 2);
  }
  function Do2(e3) {
    var t3 = uo2();
    if (typeof e3 == `function`) {
      var n3 = e3;
      if (e3 = n3(), Xa2) {
        ze2(true);
        try {
          n3();
        } finally {
          ze2(false);
        }
      }
    }
    return t3.memoizedState = t3.baseState = e3, t3.queue = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: _o2, lastRenderedState: e3 }, t3;
  }
  function Oo2(e3, t3, n3, r3) {
    return e3.baseState = n3, yo2(e3, R2, typeof r3 == `function` ? r3 : _o2);
  }
  function ko2(e3, t3, n3, r3, a3) {
    if (gs2(e3)) throw Error(i2(485));
    if (e3 = t3.action, e3 !== null) {
      var o3 = { payload: a3, action: e3, next: null, isTransition: true, status: `pending`, value: null, reason: null, listeners: [], then: function(e4) {
        o3.listeners.push(e4);
      } };
      w2.T === null ? o3.isTransition = false : n3(true), r3(o3), n3 = t3.pending, n3 === null ? (o3.next = t3.pending = o3, Ao2(t3, o3)) : (o3.next = n3.next, t3.pending = n3.next = o3);
    }
  }
  function Ao2(e3, t3) {
    var n3 = t3.action, r3 = t3.payload, i3 = e3.state;
    if (t3.isTransition) {
      var a3 = w2.T, o3 = {};
      w2.T = o3;
      try {
        var s3 = n3(i3, r3), c3 = w2.S;
        c3 !== null && c3(o3, s3), jo2(e3, t3, s3);
      } catch (n4) {
        No2(e3, t3, n4);
      } finally {
        w2.T = a3;
      }
    } else try {
      a3 = n3(i3, r3), jo2(e3, t3, a3);
    } catch (n4) {
      No2(e3, t3, n4);
    }
  }
  function jo2(e3, t3, n3) {
    typeof n3 == `object` && n3 && typeof n3.then == `function` ? n3.then(function(n4) {
      Mo2(e3, t3, n4);
    }, function(n4) {
      return No2(e3, t3, n4);
    }) : Mo2(e3, t3, n3);
  }
  function Mo2(e3, t3, n3) {
    t3.status = `fulfilled`, t3.value = n3, Po2(t3), e3.state = n3, t3 = e3.pending, t3 !== null && (n3 = t3.next, n3 === t3 ? e3.pending = null : (n3 = n3.next, t3.next = n3, Ao2(e3, n3)));
  }
  function No2(e3, t3, n3) {
    var r3 = e3.pending;
    if (e3.pending = null, r3 !== null) {
      r3 = r3.next;
      do
        t3.status = `rejected`, t3.reason = n3, Po2(t3), t3 = t3.next;
      while (t3 !== r3);
    }
    e3.action = null;
  }
  function Po2(e3) {
    e3 = e3.listeners;
    for (var t3 = 0; t3 < e3.length; t3++) (0, e3[t3])();
  }
  function Fo2(e3, t3) {
    return t3;
  }
  function Io2(e3, t3) {
    if (I2) {
      var n3 = U2.formState;
      if (n3 !== null) {
        a: {
          var r3 = L2;
          if (I2) {
            if (Mi2) {
              b: {
                for (var i3 = Mi2, a3 = Pi2; i3.nodeType !== 8; ) {
                  if (!a3) {
                    i3 = null;
                    break b;
                  }
                  if (i3 = qd2(i3.nextSibling), i3 === null) {
                    i3 = null;
                    break b;
                  }
                }
                a3 = i3.data, i3 = a3 === `F!` || a3 === `F` ? i3 : null;
              }
              if (i3) {
                Mi2 = qd2(i3.nextSibling), r3 = i3.data === `F!`;
                break a;
              }
            }
            Ii2(r3);
          }
          r3 = false;
        }
        r3 && (t3 = n3[0]);
      }
    }
    return n3 = uo2(), n3.memoizedState = n3.baseState = t3, r3 = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: Fo2, lastRenderedState: t3 }, n3.queue = r3, n3 = ps2.bind(null, L2, r3), r3.dispatch = n3, r3 = Do2(false), a3 = hs2.bind(null, L2, false, r3.queue), r3 = uo2(), i3 = { state: t3, dispatch: null, action: e3, pending: null }, r3.queue = i3, n3 = ko2.bind(null, L2, i3, a3, n3), i3.dispatch = n3, r3.memoizedState = e3, [t3, n3, false];
  }
  function Lo2(e3) {
    return Ro2(fo2(), R2, e3);
  }
  function Ro2(e3, t3, n3) {
    if (t3 = yo2(e3, t3, Fo2)[0], e3 = vo2(_o2)[0], typeof t3 == `object` && t3 && typeof t3.then == `function`) try {
      var r3 = mo2(t3);
    } catch (e4) {
      throw e4 === ba2 ? Sa2 : e4;
    }
    else r3 = t3;
    t3 = fo2();
    var i3 = t3.queue, a3 = i3.dispatch;
    return n3 !== t3.memoizedState && (L2.flags |= 2048, Vo2(9, Ho2(), zo2.bind(null, i3, n3), null)), [r3, a3, e3];
  }
  function zo2(e3, t3) {
    e3.action = t3;
  }
  function Bo2(e3) {
    var t3 = fo2(), n3 = R2;
    if (n3 !== null) return Ro2(t3, n3, e3);
    fo2(), t3 = t3.memoizedState, n3 = fo2();
    var r3 = n3.queue.dispatch;
    return n3.memoizedState = e3, [t3, r3, false];
  }
  function Vo2(e3, t3, n3, r3) {
    return e3 = { tag: e3, create: n3, deps: r3, inst: t3, next: null }, t3 = L2.updateQueue, t3 === null && (t3 = po2(), L2.updateQueue = t3), n3 = t3.lastEffect, n3 === null ? t3.lastEffect = e3.next = e3 : (r3 = n3.next, n3.next = e3, e3.next = r3, t3.lastEffect = e3), e3;
  }
  function Ho2() {
    return { destroy: void 0, resource: void 0 };
  }
  function Uo2() {
    return fo2().memoizedState;
  }
  function Wo2(e3, t3, n3, r3) {
    var i3 = uo2();
    r3 = r3 === void 0 ? null : r3, L2.flags |= e3, i3.memoizedState = Vo2(1 | t3, Ho2(), n3, r3);
  }
  function Go2(e3, t3, n3, r3) {
    var i3 = fo2();
    r3 = r3 === void 0 ? null : r3;
    var a3 = i3.memoizedState.inst;
    R2 !== null && r3 !== null && no2(r3, R2.memoizedState.deps) ? i3.memoizedState = Vo2(t3, a3, n3, r3) : (L2.flags |= e3, i3.memoizedState = Vo2(1 | t3, a3, n3, r3));
  }
  function Ko2(e3, t3) {
    Wo2(8390656, 8, e3, t3);
  }
  function qo2(e3, t3) {
    Go2(2048, 8, e3, t3);
  }
  function Jo2(e3, t3) {
    return Go2(4, 2, e3, t3);
  }
  function Yo2(e3, t3) {
    return Go2(4, 4, e3, t3);
  }
  function Xo2(e3, t3) {
    if (typeof t3 == `function`) {
      e3 = e3();
      var n3 = t3(e3);
      return function() {
        typeof n3 == `function` ? n3() : t3(null);
      };
    }
    if (t3 != null) return e3 = e3(), t3.current = e3, function() {
      t3.current = null;
    };
  }
  function Zo2(e3, t3, n3) {
    n3 = n3 == null ? null : n3.concat([e3]), Go2(4, 4, Xo2.bind(null, t3, e3), n3);
  }
  function Qo2() {
  }
  function $o2(e3, t3) {
    var n3 = fo2();
    t3 = t3 === void 0 ? null : t3;
    var r3 = n3.memoizedState;
    return t3 !== null && no2(t3, r3[1]) ? r3[0] : (n3.memoizedState = [e3, t3], e3);
  }
  function es2(e3, t3) {
    var n3 = fo2();
    t3 = t3 === void 0 ? null : t3;
    var r3 = n3.memoizedState;
    if (t3 !== null && no2(t3, r3[1])) return r3[0];
    if (r3 = e3(), Xa2) {
      ze2(true);
      try {
        e3();
      } finally {
        ze2(false);
      }
    }
    return n3.memoizedState = [r3, t3], r3;
  }
  function ts2(e3, t3, n3) {
    return n3 === void 0 || qa2 & 1073741824 ? e3.memoizedState = t3 : (e3.memoizedState = n3, e3 = ou2(), L2.lanes |= e3, Rl2 |= e3, n3);
  }
  function ns2(e3, t3, n3, r3) {
    return Cr2(n3, t3) ? n3 : Ha2.current === null ? qa2 & 42 ? (e3 = ou2(), L2.lanes |= e3, Rl2 |= e3, t3) : (tc2 = true, e3.memoizedState = n3) : (e3 = ts2(e3, n3, r3), Cr2(e3, t3) || (tc2 = true), e3);
  }
  function rs2(e3, t3, n3, r3, i3) {
    var a3 = T2.p;
    T2.p = a3 !== 0 && 8 > a3 ? a3 : 8;
    var o3 = w2.T, s3 = {};
    w2.T = s3, hs2(e3, false, t3, n3);
    try {
      var c3 = i3(), l3 = w2.S;
      l3 !== null && l3(s3, c3), typeof c3 == `object` && c3 && typeof c3.then == `function` ? ms2(e3, t3, ma2(c3, r3), au2(e3)) : ms2(e3, t3, r3, au2(e3));
    } catch (n4) {
      ms2(e3, t3, { then: function() {
      }, status: `rejected`, reason: n4 }, au2());
    } finally {
      T2.p = a3, w2.T = o3;
    }
  }
  function is2() {
  }
  function as2(e3, t3, n3, r3) {
    if (e3.tag !== 5) throw Error(i2(476));
    var a3 = os2(e3).queue;
    rs2(e3, a3, t3, le2, n3 === null ? is2 : function() {
      return ss2(e3), n3(r3);
    });
  }
  function os2(e3) {
    var t3 = e3.memoizedState;
    if (t3 !== null) return t3;
    t3 = { memoizedState: le2, baseState: le2, baseQueue: null, queue: { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: _o2, lastRenderedState: le2 }, next: null };
    var n3 = {};
    return t3.next = { memoizedState: n3, baseState: n3, baseQueue: null, queue: { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: _o2, lastRenderedState: n3 }, next: null }, e3.memoizedState = t3, e3 = e3.alternate, e3 !== null && (e3.memoizedState = t3), t3;
  }
  function ss2(e3) {
    var t3 = os2(e3).next.queue;
    ms2(e3, t3, {}, au2());
  }
  function cs2() {
    return $i2(Rf2);
  }
  function ls2() {
    return fo2().memoizedState;
  }
  function us2() {
    return fo2().memoizedState;
  }
  function ds2(e3) {
    for (var t3 = e3.return; t3 !== null; ) {
      switch (t3.tag) {
        case 24:
        case 3:
          var n3 = au2();
          e3 = Na2(n3);
          var r3 = Pa2(t3, e3, n3);
          r3 !== null && (su2(r3, t3, n3), Fa2(r3, t3, n3)), t3 = { cache: oa2() }, e3.payload = t3;
          return;
      }
      t3 = t3.return;
    }
  }
  function fs2(e3, t3, n3) {
    var r3 = au2();
    n3 = { lane: r3, revertLane: 0, action: n3, hasEagerState: false, eagerState: null, next: null }, gs2(e3) ? _s2(t3, n3) : (n3 = ii2(e3, t3, n3, r3), n3 !== null && (su2(n3, e3, r3), vs2(n3, t3, r3)));
  }
  function ps2(e3, t3, n3) {
    ms2(e3, t3, n3, au2());
  }
  function ms2(e3, t3, n3, r3) {
    var i3 = { lane: r3, revertLane: 0, action: n3, hasEagerState: false, eagerState: null, next: null };
    if (gs2(e3)) _s2(t3, i3);
    else {
      var a3 = e3.alternate;
      if (e3.lanes === 0 && (a3 === null || a3.lanes === 0) && (a3 = t3.lastRenderedReducer, a3 !== null)) try {
        var o3 = t3.lastRenderedState, s3 = a3(o3, n3);
        if (i3.hasEagerState = true, i3.eagerState = s3, Cr2(s3, o3)) return ri2(e3, t3, i3, 0), U2 === null && ni2(), false;
      } catch {
      }
      if (n3 = ii2(e3, t3, i3, r3), n3 !== null) return su2(n3, e3, r3), vs2(n3, t3, r3), true;
    }
    return false;
  }
  function hs2(e3, t3, n3, r3) {
    if (r3 = { lane: 2, revertLane: nd2(), action: r3, hasEagerState: false, eagerState: null, next: null }, gs2(e3)) {
      if (t3) throw Error(i2(479));
    } else t3 = ii2(e3, n3, r3, 2), t3 !== null && su2(t3, e3, 2);
  }
  function gs2(e3) {
    var t3 = e3.alternate;
    return e3 === L2 || t3 !== null && t3 === L2;
  }
  function _s2(e3, t3) {
    Ya2 = Ja2 = true;
    var n3 = e3.pending;
    n3 === null ? t3.next = t3 : (t3.next = n3.next, n3.next = t3), e3.pending = t3;
  }
  function vs2(e3, t3, n3) {
    if (n3 & 4194048) {
      var r3 = t3.lanes;
      r3 &= e3.pendingLanes, n3 |= r3, t3.lanes = n3, tt2(e3, n3);
    }
  }
  var ys2 = { readContext: $i2, use: ho2, useCallback: to2, useContext: to2, useEffect: to2, useImperativeHandle: to2, useLayoutEffect: to2, useInsertionEffect: to2, useMemo: to2, useReducer: to2, useRef: to2, useState: to2, useDebugValue: to2, useDeferredValue: to2, useTransition: to2, useSyncExternalStore: to2, useId: to2, useHostTransitionStatus: to2, useFormState: to2, useActionState: to2, useOptimistic: to2, useMemoCache: to2, useCacheRefresh: to2 }, bs2 = { readContext: $i2, use: ho2, useCallback: function(e3, t3) {
    return uo2().memoizedState = [e3, t3 === void 0 ? null : t3], e3;
  }, useContext: $i2, useEffect: Ko2, useImperativeHandle: function(e3, t3, n3) {
    n3 = n3 == null ? null : n3.concat([e3]), Wo2(4194308, 4, Xo2.bind(null, t3, e3), n3);
  }, useLayoutEffect: function(e3, t3) {
    return Wo2(4194308, 4, e3, t3);
  }, useInsertionEffect: function(e3, t3) {
    Wo2(4, 2, e3, t3);
  }, useMemo: function(e3, t3) {
    var n3 = uo2();
    t3 = t3 === void 0 ? null : t3;
    var r3 = e3();
    if (Xa2) {
      ze2(true);
      try {
        e3();
      } finally {
        ze2(false);
      }
    }
    return n3.memoizedState = [r3, t3], r3;
  }, useReducer: function(e3, t3, n3) {
    var r3 = uo2();
    if (n3 !== void 0) {
      var i3 = n3(t3);
      if (Xa2) {
        ze2(true);
        try {
          n3(t3);
        } finally {
          ze2(false);
        }
      }
    } else i3 = t3;
    return r3.memoizedState = r3.baseState = i3, e3 = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: e3, lastRenderedState: i3 }, r3.queue = e3, e3 = e3.dispatch = fs2.bind(null, L2, e3), [r3.memoizedState, e3];
  }, useRef: function(e3) {
    var t3 = uo2();
    return e3 = { current: e3 }, t3.memoizedState = e3;
  }, useState: function(e3) {
    e3 = Do2(e3);
    var t3 = e3.queue, n3 = ps2.bind(null, L2, t3);
    return t3.dispatch = n3, [e3.memoizedState, n3];
  }, useDebugValue: Qo2, useDeferredValue: function(e3, t3) {
    return ts2(uo2(), e3, t3);
  }, useTransition: function() {
    var e3 = Do2(false);
    return e3 = rs2.bind(null, L2, e3.queue, true, false), uo2().memoizedState = e3, [false, e3];
  }, useSyncExternalStore: function(e3, t3, n3) {
    var r3 = L2, a3 = uo2();
    if (I2) {
      if (n3 === void 0) throw Error(i2(407));
      n3 = n3();
    } else {
      if (n3 = t3(), U2 === null) throw Error(i2(349));
      G2 & 124 || So2(r3, t3, n3);
    }
    a3.memoizedState = n3;
    var o3 = { value: n3, getSnapshot: t3 };
    return a3.queue = o3, Ko2(wo2.bind(null, r3, o3, e3), [e3]), r3.flags |= 2048, Vo2(9, Ho2(), Co2.bind(null, r3, o3, n3, t3), null), n3;
  }, useId: function() {
    var e3 = uo2(), t3 = U2.identifierPrefix;
    if (I2) {
      var n3 = Ei2, r3 = Ti2;
      n3 = (r3 & ~(1 << 32 - k2(r3) - 1)).toString(32) + n3, t3 = `«` + t3 + `R` + n3, n3 = Za2++, 0 < n3 && (t3 += `H` + n3.toString(32)), t3 += `»`;
    } else n3 = eo2++, t3 = `«` + t3 + `r` + n3.toString(32) + `»`;
    return e3.memoizedState = t3;
  }, useHostTransitionStatus: cs2, useFormState: Io2, useActionState: Io2, useOptimistic: function(e3) {
    var t3 = uo2();
    t3.memoizedState = t3.baseState = e3;
    var n3 = { pending: null, lanes: 0, dispatch: null, lastRenderedReducer: null, lastRenderedState: null };
    return t3.queue = n3, t3 = hs2.bind(null, L2, true, n3), n3.dispatch = t3, [e3, t3];
  }, useMemoCache: go2, useCacheRefresh: function() {
    return uo2().memoizedState = ds2.bind(null, L2);
  } }, xs2 = { readContext: $i2, use: ho2, useCallback: $o2, useContext: $i2, useEffect: qo2, useImperativeHandle: Zo2, useInsertionEffect: Jo2, useLayoutEffect: Yo2, useMemo: es2, useReducer: vo2, useRef: Uo2, useState: function() {
    return vo2(_o2);
  }, useDebugValue: Qo2, useDeferredValue: function(e3, t3) {
    return ns2(fo2(), R2.memoizedState, e3, t3);
  }, useTransition: function() {
    var e3 = vo2(_o2)[0], t3 = fo2().memoizedState;
    return [typeof e3 == `boolean` ? e3 : mo2(e3), t3];
  }, useSyncExternalStore: xo2, useId: ls2, useHostTransitionStatus: cs2, useFormState: Lo2, useActionState: Lo2, useOptimistic: function(e3, t3) {
    return Oo2(fo2(), R2, e3, t3);
  }, useMemoCache: go2, useCacheRefresh: us2 }, Ss2 = { readContext: $i2, use: ho2, useCallback: $o2, useContext: $i2, useEffect: qo2, useImperativeHandle: Zo2, useInsertionEffect: Jo2, useLayoutEffect: Yo2, useMemo: es2, useReducer: bo2, useRef: Uo2, useState: function() {
    return bo2(_o2);
  }, useDebugValue: Qo2, useDeferredValue: function(e3, t3) {
    var n3 = fo2();
    return R2 === null ? ts2(n3, e3, t3) : ns2(n3, R2.memoizedState, e3, t3);
  }, useTransition: function() {
    var e3 = bo2(_o2)[0], t3 = fo2().memoizedState;
    return [typeof e3 == `boolean` ? e3 : mo2(e3), t3];
  }, useSyncExternalStore: xo2, useId: ls2, useHostTransitionStatus: cs2, useFormState: Bo2, useActionState: Bo2, useOptimistic: function(e3, t3) {
    var n3 = fo2();
    return R2 === null ? (n3.baseState = e3, [e3, n3.queue.dispatch]) : Oo2(n3, R2, e3, t3);
  }, useMemoCache: go2, useCacheRefresh: us2 }, Cs2 = null, ws2 = 0;
  function Ts2(e3) {
    var t3 = ws2;
    return ws2 += 1, Cs2 === null && (Cs2 = []), Ea2(Cs2, e3, t3);
  }
  function Es2(e3, t3) {
    t3 = t3.props.ref, e3.ref = t3 === void 0 ? null : t3;
  }
  function Ds2(e3, t3) {
    throw t3.$$typeof === f2 ? Error(i2(525)) : (e3 = Object.prototype.toString.call(t3), Error(i2(31, e3 === `[object Object]` ? `object with keys {` + Object.keys(t3).join(`, `) + `}` : e3)));
  }
  function Os2(e3) {
    var t3 = e3._init;
    return t3(e3._payload);
  }
  function ks2(e3) {
    function t3(t4, n4) {
      if (e3) {
        var r4 = t4.deletions;
        r4 === null ? (t4.deletions = [n4], t4.flags |= 16) : r4.push(n4);
      }
    }
    function n3(n4, r4) {
      if (!e3) return null;
      for (; r4 !== null; ) t3(n4, r4), r4 = r4.sibling;
      return null;
    }
    function r3(e4) {
      for (var t4 = /* @__PURE__ */ new Map(); e4 !== null; ) e4.key === null ? t4.set(e4.index, e4) : t4.set(e4.key, e4), e4 = e4.sibling;
      return t4;
    }
    function a3(e4, t4) {
      return e4 = fi2(e4, t4), e4.index = 0, e4.sibling = null, e4;
    }
    function o3(t4, n4, r4) {
      return t4.index = r4, e3 ? (r4 = t4.alternate, r4 === null ? (t4.flags |= 67108866, n4) : (r4 = r4.index, r4 < n4 ? (t4.flags |= 67108866, n4) : r4)) : (t4.flags |= 1048576, n4);
    }
    function s3(t4) {
      return e3 && t4.alternate === null && (t4.flags |= 67108866), t4;
    }
    function c3(e4, t4, n4, r4) {
      return t4 === null || t4.tag !== 6 ? (t4 = gi2(n4, e4.mode, r4), t4.return = e4, t4) : (t4 = a3(t4, n4), t4.return = e4, t4);
    }
    function l3(e4, t4, n4, r4) {
      var i3 = n4.type;
      return i3 === h2 ? d3(e4, t4, n4.props.children, r4, n4.key) : t4 !== null && (t4.elementType === i3 || typeof i3 == `object` && i3 && i3.$$typeof === te2 && Os2(i3) === t4.type) ? (t4 = a3(t4, n4.props), Es2(t4, n4), t4.return = e4, t4) : (t4 = mi2(n4.type, n4.key, n4.props, null, e4.mode, r4), Es2(t4, n4), t4.return = e4, t4);
    }
    function u3(e4, t4, n4, r4) {
      return t4 === null || t4.tag !== 4 || t4.stateNode.containerInfo !== n4.containerInfo || t4.stateNode.implementation !== n4.implementation ? (t4 = _i2(n4, e4.mode, r4), t4.return = e4, t4) : (t4 = a3(t4, n4.children || []), t4.return = e4, t4);
    }
    function d3(e4, t4, n4, r4, i3) {
      return t4 === null || t4.tag !== 7 ? (t4 = hi2(n4, e4.mode, r4, i3), t4.return = e4, t4) : (t4 = a3(t4, n4), t4.return = e4, t4);
    }
    function f3(e4, t4, n4) {
      if (typeof t4 == `string` && t4 !== `` || typeof t4 == `number` || typeof t4 == `bigint`) return t4 = gi2(`` + t4, e4.mode, n4), t4.return = e4, t4;
      if (typeof t4 == `object` && t4) {
        switch (t4.$$typeof) {
          case p2:
            return n4 = mi2(t4.type, t4.key, t4.props, null, e4.mode, n4), Es2(n4, t4), n4.return = e4, n4;
          case m2:
            return t4 = _i2(t4, e4.mode, n4), t4.return = e4, t4;
          case te2:
            var r4 = t4._init;
            return t4 = r4(t4._payload), f3(e4, t4, n4);
        }
        if (ce2(t4) || ae2(t4)) return t4 = hi2(t4, e4.mode, n4, null), t4.return = e4, t4;
        if (typeof t4.then == `function`) return f3(e4, Ts2(t4), n4);
        if (t4.$$typeof === b2) return f3(e4, ea2(e4, t4), n4);
        Ds2(e4, t4);
      }
      return null;
    }
    function g3(e4, t4, n4, r4) {
      var i3 = t4 === null ? null : t4.key;
      if (typeof n4 == `string` && n4 !== `` || typeof n4 == `number` || typeof n4 == `bigint`) return i3 === null ? c3(e4, t4, `` + n4, r4) : null;
      if (typeof n4 == `object` && n4) {
        switch (n4.$$typeof) {
          case p2:
            return n4.key === i3 ? l3(e4, t4, n4, r4) : null;
          case m2:
            return n4.key === i3 ? u3(e4, t4, n4, r4) : null;
          case te2:
            return i3 = n4._init, n4 = i3(n4._payload), g3(e4, t4, n4, r4);
        }
        if (ce2(n4) || ae2(n4)) return i3 === null ? d3(e4, t4, n4, r4, null) : null;
        if (typeof n4.then == `function`) return g3(e4, t4, Ts2(n4), r4);
        if (n4.$$typeof === b2) return g3(e4, t4, ea2(e4, n4), r4);
        Ds2(e4, n4);
      }
      return null;
    }
    function _3(e4, t4, n4, r4, i3) {
      if (typeof r4 == `string` && r4 !== `` || typeof r4 == `number` || typeof r4 == `bigint`) return e4 = e4.get(n4) || null, c3(t4, e4, `` + r4, i3);
      if (typeof r4 == `object` && r4) {
        switch (r4.$$typeof) {
          case p2:
            return e4 = e4.get(r4.key === null ? n4 : r4.key) || null, l3(t4, e4, r4, i3);
          case m2:
            return e4 = e4.get(r4.key === null ? n4 : r4.key) || null, u3(t4, e4, r4, i3);
          case te2:
            var a4 = r4._init;
            return r4 = a4(r4._payload), _3(e4, t4, n4, r4, i3);
        }
        if (ce2(r4) || ae2(r4)) return e4 = e4.get(n4) || null, d3(t4, e4, r4, i3, null);
        if (typeof r4.then == `function`) return _3(e4, t4, n4, Ts2(r4), i3);
        if (r4.$$typeof === b2) return _3(e4, t4, n4, ea2(t4, r4), i3);
        Ds2(t4, r4);
      }
      return null;
    }
    function v3(i3, a4, s4, c4) {
      for (var l4 = null, u4 = null, d4 = a4, p3 = a4 = 0, m3 = null; d4 !== null && p3 < s4.length; p3++) {
        d4.index > p3 ? (m3 = d4, d4 = null) : m3 = d4.sibling;
        var h3 = g3(i3, d4, s4[p3], c4);
        if (h3 === null) {
          d4 === null && (d4 = m3);
          break;
        }
        e3 && d4 && h3.alternate === null && t3(i3, d4), a4 = o3(h3, a4, p3), u4 === null ? l4 = h3 : u4.sibling = h3, u4 = h3, d4 = m3;
      }
      if (p3 === s4.length) return n3(i3, d4), I2 && Di2(i3, p3), l4;
      if (d4 === null) {
        for (; p3 < s4.length; p3++) d4 = f3(i3, s4[p3], c4), d4 !== null && (a4 = o3(d4, a4, p3), u4 === null ? l4 = d4 : u4.sibling = d4, u4 = d4);
        return I2 && Di2(i3, p3), l4;
      }
      for (d4 = r3(d4); p3 < s4.length; p3++) m3 = _3(d4, i3, p3, s4[p3], c4), m3 !== null && (e3 && m3.alternate !== null && d4.delete(m3.key === null ? p3 : m3.key), a4 = o3(m3, a4, p3), u4 === null ? l4 = m3 : u4.sibling = m3, u4 = m3);
      return e3 && d4.forEach(function(e4) {
        return t3(i3, e4);
      }), I2 && Di2(i3, p3), l4;
    }
    function y3(a4, s4, c4, l4) {
      if (c4 == null) throw Error(i2(151));
      for (var u4 = null, d4 = null, p3 = s4, m3 = s4 = 0, h3 = null, v4 = c4.next(); p3 !== null && !v4.done; m3++, v4 = c4.next()) {
        p3.index > m3 ? (h3 = p3, p3 = null) : h3 = p3.sibling;
        var y4 = g3(a4, p3, v4.value, l4);
        if (y4 === null) {
          p3 === null && (p3 = h3);
          break;
        }
        e3 && p3 && y4.alternate === null && t3(a4, p3), s4 = o3(y4, s4, m3), d4 === null ? u4 = y4 : d4.sibling = y4, d4 = y4, p3 = h3;
      }
      if (v4.done) return n3(a4, p3), I2 && Di2(a4, m3), u4;
      if (p3 === null) {
        for (; !v4.done; m3++, v4 = c4.next()) v4 = f3(a4, v4.value, l4), v4 !== null && (s4 = o3(v4, s4, m3), d4 === null ? u4 = v4 : d4.sibling = v4, d4 = v4);
        return I2 && Di2(a4, m3), u4;
      }
      for (p3 = r3(p3); !v4.done; m3++, v4 = c4.next()) v4 = _3(p3, a4, m3, v4.value, l4), v4 !== null && (e3 && v4.alternate !== null && p3.delete(v4.key === null ? m3 : v4.key), s4 = o3(v4, s4, m3), d4 === null ? u4 = v4 : d4.sibling = v4, d4 = v4);
      return e3 && p3.forEach(function(e4) {
        return t3(a4, e4);
      }), I2 && Di2(a4, m3), u4;
    }
    function x3(e4, r4, o4, c4) {
      if (typeof o4 == `object` && o4 && o4.type === h2 && o4.key === null && (o4 = o4.props.children), typeof o4 == `object` && o4) {
        switch (o4.$$typeof) {
          case p2:
            a: {
              for (var l4 = o4.key; r4 !== null; ) {
                if (r4.key === l4) {
                  if (l4 = o4.type, l4 === h2) {
                    if (r4.tag === 7) {
                      n3(e4, r4.sibling), c4 = a3(r4, o4.props.children), c4.return = e4, e4 = c4;
                      break a;
                    }
                  } else if (r4.elementType === l4 || typeof l4 == `object` && l4 && l4.$$typeof === te2 && Os2(l4) === r4.type) {
                    n3(e4, r4.sibling), c4 = a3(r4, o4.props), Es2(c4, o4), c4.return = e4, e4 = c4;
                    break a;
                  }
                  n3(e4, r4);
                  break;
                } else t3(e4, r4);
                r4 = r4.sibling;
              }
              o4.type === h2 ? (c4 = hi2(o4.props.children, e4.mode, c4, o4.key), c4.return = e4, e4 = c4) : (c4 = mi2(o4.type, o4.key, o4.props, null, e4.mode, c4), Es2(c4, o4), c4.return = e4, e4 = c4);
            }
            return s3(e4);
          case m2:
            a: {
              for (l4 = o4.key; r4 !== null; ) {
                if (r4.key === l4) if (r4.tag === 4 && r4.stateNode.containerInfo === o4.containerInfo && r4.stateNode.implementation === o4.implementation) {
                  n3(e4, r4.sibling), c4 = a3(r4, o4.children || []), c4.return = e4, e4 = c4;
                  break a;
                } else {
                  n3(e4, r4);
                  break;
                }
                else t3(e4, r4);
                r4 = r4.sibling;
              }
              c4 = _i2(o4, e4.mode, c4), c4.return = e4, e4 = c4;
            }
            return s3(e4);
          case te2:
            return l4 = o4._init, o4 = l4(o4._payload), x3(e4, r4, o4, c4);
        }
        if (ce2(o4)) return v3(e4, r4, o4, c4);
        if (ae2(o4)) {
          if (l4 = ae2(o4), typeof l4 != `function`) throw Error(i2(150));
          return o4 = l4.call(o4), y3(e4, r4, o4, c4);
        }
        if (typeof o4.then == `function`) return x3(e4, r4, Ts2(o4), c4);
        if (o4.$$typeof === b2) return x3(e4, r4, ea2(e4, o4), c4);
        Ds2(e4, o4);
      }
      return typeof o4 == `string` && o4 !== `` || typeof o4 == `number` || typeof o4 == `bigint` ? (o4 = `` + o4, r4 !== null && r4.tag === 6 ? (n3(e4, r4.sibling), c4 = a3(r4, o4), c4.return = e4, e4 = c4) : (n3(e4, r4), c4 = gi2(o4, e4.mode, c4), c4.return = e4, e4 = c4), s3(e4)) : n3(e4, r4);
    }
    return function(e4, t4, n4, r4) {
      try {
        ws2 = 0;
        var i3 = x3(e4, t4, n4, r4);
        return Cs2 = null, i3;
      } catch (t5) {
        if (t5 === ba2 || t5 === Sa2) throw t5;
        var a4 = ui2(29, t5, null, e4.mode);
        return a4.lanes = r4, a4.return = e4, a4;
      }
    };
  }
  var As2 = ks2(true), js2 = ks2(false), B2 = E2(null), Ms2 = null;
  function Ns2(e3) {
    var t3 = e3.alternate;
    D2(Ls2, Ls2.current & 1), D2(B2, e3), Ms2 === null && (t3 === null || Ha2.current !== null || t3.memoizedState !== null) && (Ms2 = e3);
  }
  function Ps2(e3) {
    if (e3.tag === 22) {
      if (D2(Ls2, Ls2.current), D2(B2, e3), Ms2 === null) {
        var t3 = e3.alternate;
        t3 !== null && t3.memoizedState !== null && (Ms2 = e3);
      }
    } else Fs2(e3);
  }
  function Fs2() {
    D2(Ls2, Ls2.current), D2(B2, B2.current);
  }
  function Is2(e3) {
    fe2(B2), Ms2 === e3 && (Ms2 = null), fe2(Ls2);
  }
  var Ls2 = E2(0);
  function Rs2(e3) {
    for (var t3 = e3; t3 !== null; ) {
      if (t3.tag === 13) {
        var n3 = t3.memoizedState;
        if (n3 !== null && (n3 = n3.dehydrated, n3 === null || n3.data === `$?` || Gd2(n3))) return t3;
      } else if (t3.tag === 19 && t3.memoizedProps.revealOrder !== void 0) {
        if (t3.flags & 128) return t3;
      } else if (t3.child !== null) {
        t3.child.return = t3, t3 = t3.child;
        continue;
      }
      if (t3 === e3) break;
      for (; t3.sibling === null; ) {
        if (t3.return === null || t3.return === e3) return null;
        t3 = t3.return;
      }
      t3.sibling.return = t3.return, t3 = t3.sibling;
    }
    return null;
  }
  function zs2(e3, t3, n3, r3) {
    t3 = e3.memoizedState, n3 = n3(r3, t3), n3 = n3 == null ? t3 : d2({}, t3, n3), e3.memoizedState = n3, e3.lanes === 0 && (e3.updateQueue.baseState = n3);
  }
  var Bs2 = { enqueueSetState: function(e3, t3, n3) {
    e3 = e3._reactInternals;
    var r3 = au2(), i3 = Na2(r3);
    i3.payload = t3, n3 != null && (i3.callback = n3), t3 = Pa2(e3, i3, r3), t3 !== null && (su2(t3, e3, r3), Fa2(t3, e3, r3));
  }, enqueueReplaceState: function(e3, t3, n3) {
    e3 = e3._reactInternals;
    var r3 = au2(), i3 = Na2(r3);
    i3.tag = 1, i3.payload = t3, n3 != null && (i3.callback = n3), t3 = Pa2(e3, i3, r3), t3 !== null && (su2(t3, e3, r3), Fa2(t3, e3, r3));
  }, enqueueForceUpdate: function(e3, t3) {
    e3 = e3._reactInternals;
    var n3 = au2(), r3 = Na2(n3);
    r3.tag = 2, t3 != null && (r3.callback = t3), t3 = Pa2(e3, r3, n3), t3 !== null && (su2(t3, e3, n3), Fa2(t3, e3, n3));
  } };
  function Vs2(e3, t3, n3, r3, i3, a3, o3) {
    return e3 = e3.stateNode, typeof e3.shouldComponentUpdate == `function` ? e3.shouldComponentUpdate(r3, a3, o3) : t3.prototype && t3.prototype.isPureReactComponent ? !wr2(n3, r3) || !wr2(i3, a3) : true;
  }
  function Hs2(e3, t3, n3, r3) {
    e3 = t3.state, typeof t3.componentWillReceiveProps == `function` && t3.componentWillReceiveProps(n3, r3), typeof t3.UNSAFE_componentWillReceiveProps == `function` && t3.UNSAFE_componentWillReceiveProps(n3, r3), t3.state !== e3 && Bs2.enqueueReplaceState(t3, t3.state, null);
  }
  function Us2(e3, t3) {
    var n3 = t3;
    if (`ref` in t3) for (var r3 in n3 = {}, t3) r3 !== `ref` && (n3[r3] = t3[r3]);
    if (e3 = e3.defaultProps) for (var i3 in n3 === t3 && (n3 = d2({}, n3)), e3) n3[i3] === void 0 && (n3[i3] = e3[i3]);
    return n3;
  }
  var Ws2 = typeof reportError == `function` ? reportError : function(e3) {
    if (typeof window == `object` && typeof window.ErrorEvent == `function`) {
      var t3 = new window.ErrorEvent(`error`, { bubbles: true, cancelable: true, message: typeof e3 == `object` && e3 && typeof e3.message == `string` ? String(e3.message) : String(e3), error: e3 });
      if (!window.dispatchEvent(t3)) return;
    } else if (typeof process == `object` && typeof process.emit == `function`) {
      process.emit(`uncaughtException`, e3);
      return;
    }
    console.error(e3);
  };
  function Gs2(e3) {
    Ws2(e3);
  }
  function Ks2(e3) {
    console.error(e3);
  }
  function qs2(e3) {
    Ws2(e3);
  }
  function Js2(e3, t3) {
    try {
      var n3 = e3.onUncaughtError;
      n3(t3.value, { componentStack: t3.stack });
    } catch (e4) {
      setTimeout(function() {
        throw e4;
      });
    }
  }
  function Ys2(e3, t3, n3) {
    try {
      var r3 = e3.onCaughtError;
      r3(n3.value, { componentStack: n3.stack, errorBoundary: t3.tag === 1 ? t3.stateNode : null });
    } catch (e4) {
      setTimeout(function() {
        throw e4;
      });
    }
  }
  function Xs2(e3, t3, n3) {
    return n3 = Na2(n3), n3.tag = 3, n3.payload = { element: null }, n3.callback = function() {
      Js2(e3, t3);
    }, n3;
  }
  function Zs2(e3) {
    return e3 = Na2(e3), e3.tag = 3, e3;
  }
  function Qs2(e3, t3, n3, r3) {
    var i3 = n3.type.getDerivedStateFromError;
    if (typeof i3 == `function`) {
      var a3 = r3.value;
      e3.payload = function() {
        return i3(a3);
      }, e3.callback = function() {
        Ys2(t3, n3, r3);
      };
    }
    var o3 = n3.stateNode;
    o3 !== null && typeof o3.componentDidCatch == `function` && (e3.callback = function() {
      Ys2(t3, n3, r3), typeof i3 != `function` && (Yl2 === null ? Yl2 = /* @__PURE__ */ new Set([this]) : Yl2.add(this));
      var e4 = r3.stack;
      this.componentDidCatch(r3.value, { componentStack: e4 === null ? `` : e4 });
    });
  }
  function $s2(e3, t3, n3, r3, a3) {
    if (n3.flags |= 32768, typeof r3 == `object` && r3 && typeof r3.then == `function`) {
      if (t3 = n3.alternate, t3 !== null && Xi2(t3, n3, a3, true), n3 = B2.current, n3 !== null) {
        switch (n3.tag) {
          case 13:
            return Ms2 === null ? vu2() : n3.alternate === null && Ll2 === 0 && (Ll2 = 3), n3.flags &= -257, n3.flags |= 65536, n3.lanes = a3, r3 === Ca2 ? n3.flags |= 16384 : (t3 = n3.updateQueue, t3 === null ? n3.updateQueue = /* @__PURE__ */ new Set([r3]) : t3.add(r3), Iu2(e3, r3, a3)), false;
          case 22:
            return n3.flags |= 65536, r3 === Ca2 ? n3.flags |= 16384 : (t3 = n3.updateQueue, t3 === null ? (t3 = { transitions: null, markerInstances: null, retryQueue: /* @__PURE__ */ new Set([r3]) }, n3.updateQueue = t3) : (n3 = t3.retryQueue, n3 === null ? t3.retryQueue = /* @__PURE__ */ new Set([r3]) : n3.add(r3)), Iu2(e3, r3, a3)), false;
        }
        throw Error(i2(435, n3.tag));
      }
      return Iu2(e3, r3, a3), vu2(), false;
    }
    if (I2) return t3 = B2.current, t3 === null ? (r3 !== Fi2 && (t3 = Error(i2(423), { cause: r3 }), Hi2(Qr2(t3, n3))), e3 = e3.current.alternate, e3.flags |= 65536, a3 &= -a3, e3.lanes |= a3, r3 = Qr2(r3, n3), a3 = Xs2(e3.stateNode, r3, a3), Ia2(e3, a3), Ll2 !== 4 && (Ll2 = 2)) : (!(t3.flags & 65536) && (t3.flags |= 256), t3.flags |= 65536, t3.lanes = a3, r3 !== Fi2 && (e3 = Error(i2(422), { cause: r3 }), Hi2(Qr2(e3, n3)))), false;
    var o3 = Error(i2(520), { cause: r3 });
    if (o3 = Qr2(o3, n3), Ul2 === null ? Ul2 = [o3] : Ul2.push(o3), Ll2 !== 4 && (Ll2 = 2), t3 === null) return true;
    r3 = Qr2(r3, n3), n3 = t3;
    do {
      switch (n3.tag) {
        case 3:
          return n3.flags |= 65536, e3 = a3 & -a3, n3.lanes |= e3, e3 = Xs2(n3.stateNode, r3, e3), Ia2(n3, e3), false;
        case 1:
          if (t3 = n3.type, o3 = n3.stateNode, !(n3.flags & 128) && (typeof t3.getDerivedStateFromError == `function` || o3 !== null && typeof o3.componentDidCatch == `function` && (Yl2 === null || !Yl2.has(o3)))) return n3.flags |= 65536, a3 &= -a3, n3.lanes |= a3, a3 = Zs2(a3), Qs2(a3, e3, n3, r3), Ia2(n3, a3), false;
      }
      n3 = n3.return;
    } while (n3 !== null);
    return false;
  }
  var ec2 = Error(i2(461)), tc2 = false;
  function nc2(e3, t3, n3, r3) {
    t3.child = e3 === null ? js2(t3, null, n3, r3) : As2(t3, e3.child, n3, r3);
  }
  function rc2(e3, t3, n3, r3, i3) {
    n3 = n3.render;
    var a3 = t3.ref;
    if (`ref` in r3) {
      var o3 = {};
      for (var s3 in r3) s3 !== `ref` && (o3[s3] = r3[s3]);
    } else o3 = r3;
    return Qi2(t3), r3 = ro2(e3, t3, n3, o3, a3, i3), s3 = so2(), e3 !== null && !tc2 ? (co2(e3, t3, i3), Cc2(e3, t3, i3)) : (I2 && s3 && ki2(t3), t3.flags |= 1, nc2(e3, t3, r3, i3), t3.child);
  }
  function ic2(e3, t3, n3, r3, i3) {
    if (e3 === null) {
      var a3 = n3.type;
      return typeof a3 == `function` && !di2(a3) && a3.defaultProps === void 0 && n3.compare === null ? (t3.tag = 15, t3.type = a3, ac2(e3, t3, a3, r3, i3)) : (e3 = mi2(n3.type, null, r3, t3, t3.mode, i3), e3.ref = t3.ref, e3.return = t3, t3.child = e3);
    }
    if (a3 = e3.child, !wc2(e3, i3)) {
      var o3 = a3.memoizedProps;
      if (n3 = n3.compare, n3 = n3 === null ? wr2 : n3, n3(o3, r3) && e3.ref === t3.ref) return Cc2(e3, t3, i3);
    }
    return t3.flags |= 1, e3 = fi2(a3, r3), e3.ref = t3.ref, e3.return = t3, t3.child = e3;
  }
  function ac2(e3, t3, n3, r3, i3) {
    if (e3 !== null) {
      var a3 = e3.memoizedProps;
      if (wr2(a3, r3) && e3.ref === t3.ref) if (tc2 = false, t3.pendingProps = r3 = a3, wc2(e3, i3)) e3.flags & 131072 && (tc2 = true);
      else return t3.lanes = e3.lanes, Cc2(e3, t3, i3);
    }
    return lc2(e3, t3, n3, r3, i3);
  }
  function oc2(e3, t3, n3) {
    var r3 = t3.pendingProps, i3 = r3.children, a3 = e3 === null ? null : e3.memoizedState;
    if (r3.mode === `hidden`) {
      if (t3.flags & 128) {
        if (r3 = a3 === null ? n3 : a3.baseLanes | n3, e3 !== null) {
          for (i3 = t3.child = e3.child, a3 = 0; i3 !== null; ) a3 = a3 | i3.lanes | i3.childLanes, i3 = i3.sibling;
          t3.childLanes = a3 & ~r3;
        } else t3.childLanes = 0, t3.child = null;
        return sc2(e3, t3, r3, n3);
      }
      if (n3 & 536870912) t3.memoizedState = { baseLanes: 0, cachePool: null }, e3 !== null && va2(t3, a3 === null ? null : a3.cachePool), a3 === null ? Ga2() : Wa2(t3, a3), Ps2(t3);
      else return t3.lanes = t3.childLanes = 536870912, sc2(e3, t3, a3 === null ? n3 : a3.baseLanes | n3, n3);
    } else a3 === null ? (e3 !== null && va2(t3, null), Ga2(), Fs2(t3)) : (va2(t3, a3.cachePool), Wa2(t3, a3), Fs2(t3), t3.memoizedState = null);
    return nc2(e3, t3, i3, n3), t3.child;
  }
  function sc2(e3, t3, n3, r3) {
    var i3 = _a2();
    return i3 = i3 === null ? null : { parent: aa2._currentValue, pool: i3 }, t3.memoizedState = { baseLanes: n3, cachePool: i3 }, e3 !== null && va2(t3, null), Ga2(), Ps2(t3), e3 !== null && Xi2(e3, t3, r3, true), null;
  }
  function cc2(e3, t3) {
    var n3 = t3.ref;
    if (n3 === null) e3 !== null && e3.ref !== null && (t3.flags |= 4194816);
    else {
      if (typeof n3 != `function` && typeof n3 != `object`) throw Error(i2(284));
      (e3 === null || e3.ref !== n3) && (t3.flags |= 4194816);
    }
  }
  function lc2(e3, t3, n3, r3, i3) {
    return Qi2(t3), n3 = ro2(e3, t3, n3, r3, void 0, i3), r3 = so2(), e3 !== null && !tc2 ? (co2(e3, t3, i3), Cc2(e3, t3, i3)) : (I2 && r3 && ki2(t3), t3.flags |= 1, nc2(e3, t3, n3, i3), t3.child);
  }
  function uc2(e3, t3, n3, r3, i3, a3) {
    return Qi2(t3), t3.updateQueue = null, n3 = ao2(t3, r3, n3, i3), io2(e3), r3 = so2(), e3 !== null && !tc2 ? (co2(e3, t3, a3), Cc2(e3, t3, a3)) : (I2 && r3 && ki2(t3), t3.flags |= 1, nc2(e3, t3, n3, a3), t3.child);
  }
  function dc2(e3, t3, n3, r3, i3) {
    if (Qi2(t3), t3.stateNode === null) {
      var a3 = ci2, o3 = n3.contextType;
      typeof o3 == `object` && o3 && (a3 = $i2(o3)), a3 = new n3(r3, a3), t3.memoizedState = a3.state !== null && a3.state !== void 0 ? a3.state : null, a3.updater = Bs2, t3.stateNode = a3, a3._reactInternals = t3, a3 = t3.stateNode, a3.props = r3, a3.state = t3.memoizedState, a3.refs = {}, ja2(t3), o3 = n3.contextType, a3.context = typeof o3 == `object` && o3 ? $i2(o3) : ci2, a3.state = t3.memoizedState, o3 = n3.getDerivedStateFromProps, typeof o3 == `function` && (zs2(t3, n3, o3, r3), a3.state = t3.memoizedState), typeof n3.getDerivedStateFromProps == `function` || typeof a3.getSnapshotBeforeUpdate == `function` || typeof a3.UNSAFE_componentWillMount != `function` && typeof a3.componentWillMount != `function` || (o3 = a3.state, typeof a3.componentWillMount == `function` && a3.componentWillMount(), typeof a3.UNSAFE_componentWillMount == `function` && a3.UNSAFE_componentWillMount(), o3 !== a3.state && Bs2.enqueueReplaceState(a3, a3.state, null), za2(t3, r3, a3, i3), Ra2(), a3.state = t3.memoizedState), typeof a3.componentDidMount == `function` && (t3.flags |= 4194308), r3 = true;
    } else if (e3 === null) {
      a3 = t3.stateNode;
      var s3 = t3.memoizedProps, c3 = Us2(n3, s3);
      a3.props = c3;
      var l3 = a3.context, u3 = n3.contextType;
      o3 = ci2, typeof u3 == `object` && u3 && (o3 = $i2(u3));
      var d3 = n3.getDerivedStateFromProps;
      u3 = typeof d3 == `function` || typeof a3.getSnapshotBeforeUpdate == `function`, s3 = t3.pendingProps !== s3, u3 || typeof a3.UNSAFE_componentWillReceiveProps != `function` && typeof a3.componentWillReceiveProps != `function` || (s3 || l3 !== o3) && Hs2(t3, a3, r3, o3), Aa2 = false;
      var f3 = t3.memoizedState;
      a3.state = f3, za2(t3, r3, a3, i3), Ra2(), l3 = t3.memoizedState, s3 || f3 !== l3 || Aa2 ? (typeof d3 == `function` && (zs2(t3, n3, d3, r3), l3 = t3.memoizedState), (c3 = Aa2 || Vs2(t3, n3, c3, r3, f3, l3, o3)) ? (u3 || typeof a3.UNSAFE_componentWillMount != `function` && typeof a3.componentWillMount != `function` || (typeof a3.componentWillMount == `function` && a3.componentWillMount(), typeof a3.UNSAFE_componentWillMount == `function` && a3.UNSAFE_componentWillMount()), typeof a3.componentDidMount == `function` && (t3.flags |= 4194308)) : (typeof a3.componentDidMount == `function` && (t3.flags |= 4194308), t3.memoizedProps = r3, t3.memoizedState = l3), a3.props = r3, a3.state = l3, a3.context = o3, r3 = c3) : (typeof a3.componentDidMount == `function` && (t3.flags |= 4194308), r3 = false);
    } else {
      a3 = t3.stateNode, Ma2(e3, t3), o3 = t3.memoizedProps, u3 = Us2(n3, o3), a3.props = u3, d3 = t3.pendingProps, f3 = a3.context, l3 = n3.contextType, c3 = ci2, typeof l3 == `object` && l3 && (c3 = $i2(l3)), s3 = n3.getDerivedStateFromProps, (l3 = typeof s3 == `function` || typeof a3.getSnapshotBeforeUpdate == `function`) || typeof a3.UNSAFE_componentWillReceiveProps != `function` && typeof a3.componentWillReceiveProps != `function` || (o3 !== d3 || f3 !== c3) && Hs2(t3, a3, r3, c3), Aa2 = false, f3 = t3.memoizedState, a3.state = f3, za2(t3, r3, a3, i3), Ra2();
      var p3 = t3.memoizedState;
      o3 !== d3 || f3 !== p3 || Aa2 || e3 !== null && e3.dependencies !== null && Zi2(e3.dependencies) ? (typeof s3 == `function` && (zs2(t3, n3, s3, r3), p3 = t3.memoizedState), (u3 = Aa2 || Vs2(t3, n3, u3, r3, f3, p3, c3) || e3 !== null && e3.dependencies !== null && Zi2(e3.dependencies)) ? (l3 || typeof a3.UNSAFE_componentWillUpdate != `function` && typeof a3.componentWillUpdate != `function` || (typeof a3.componentWillUpdate == `function` && a3.componentWillUpdate(r3, p3, c3), typeof a3.UNSAFE_componentWillUpdate == `function` && a3.UNSAFE_componentWillUpdate(r3, p3, c3)), typeof a3.componentDidUpdate == `function` && (t3.flags |= 4), typeof a3.getSnapshotBeforeUpdate == `function` && (t3.flags |= 1024)) : (typeof a3.componentDidUpdate != `function` || o3 === e3.memoizedProps && f3 === e3.memoizedState || (t3.flags |= 4), typeof a3.getSnapshotBeforeUpdate != `function` || o3 === e3.memoizedProps && f3 === e3.memoizedState || (t3.flags |= 1024), t3.memoizedProps = r3, t3.memoizedState = p3), a3.props = r3, a3.state = p3, a3.context = c3, r3 = u3) : (typeof a3.componentDidUpdate != `function` || o3 === e3.memoizedProps && f3 === e3.memoizedState || (t3.flags |= 4), typeof a3.getSnapshotBeforeUpdate != `function` || o3 === e3.memoizedProps && f3 === e3.memoizedState || (t3.flags |= 1024), r3 = false);
    }
    return a3 = r3, cc2(e3, t3), r3 = (t3.flags & 128) != 0, a3 || r3 ? (a3 = t3.stateNode, n3 = r3 && typeof n3.getDerivedStateFromError != `function` ? null : a3.render(), t3.flags |= 1, e3 !== null && r3 ? (t3.child = As2(t3, e3.child, null, i3), t3.child = As2(t3, null, n3, i3)) : nc2(e3, t3, n3, i3), t3.memoizedState = a3.state, e3 = t3.child) : e3 = Cc2(e3, t3, i3), e3;
  }
  function fc2(e3, t3, n3, r3) {
    return Bi2(), t3.flags |= 256, nc2(e3, t3, n3, r3), t3.child;
  }
  var pc2 = { dehydrated: null, treeContext: null, retryLane: 0, hydrationErrors: null };
  function mc2(e3) {
    return { baseLanes: e3, cachePool: ya2() };
  }
  function hc2(e3, t3, n3) {
    return e3 = e3 === null ? 0 : e3.childLanes & ~n3, t3 && (e3 |= Vl2), e3;
  }
  function gc2(e3, t3, n3) {
    var r3 = t3.pendingProps, a3 = false, o3 = (t3.flags & 128) != 0, s3;
    if ((s3 = o3) || (s3 = e3 !== null && e3.memoizedState === null ? false : (Ls2.current & 2) != 0), s3 && (a3 = true, t3.flags &= -129), s3 = (t3.flags & 32) != 0, t3.flags &= -33, e3 === null) {
      if (I2) {
        if (a3 ? Ns2(t3) : Fs2(t3), I2) {
          var c3 = Mi2, l3;
          if (l3 = c3) {
            c: {
              for (l3 = c3, c3 = Pi2; l3.nodeType !== 8; ) {
                if (!c3) {
                  c3 = null;
                  break c;
                }
                if (l3 = qd2(l3.nextSibling), l3 === null) {
                  c3 = null;
                  break c;
                }
              }
              c3 = l3;
            }
            c3 === null ? l3 = false : (t3.memoizedState = { dehydrated: c3, treeContext: wi2 === null ? null : { id: Ti2, overflow: Ei2 }, retryLane: 536870912, hydrationErrors: null }, l3 = ui2(18, null, null, 0), l3.stateNode = c3, l3.return = t3, t3.child = l3, ji2 = t3, Mi2 = null, l3 = true);
          }
          l3 || Ii2(t3);
        }
        if (c3 = t3.memoizedState, c3 !== null && (c3 = c3.dehydrated, c3 !== null)) return Gd2(c3) ? t3.lanes = 32 : t3.lanes = 536870912, null;
        Is2(t3);
      }
      return c3 = r3.children, r3 = r3.fallback, a3 ? (Fs2(t3), a3 = t3.mode, c3 = vc2({ mode: `hidden`, children: c3 }, a3), r3 = hi2(r3, a3, n3, null), c3.return = t3, r3.return = t3, c3.sibling = r3, t3.child = c3, a3 = t3.child, a3.memoizedState = mc2(n3), a3.childLanes = hc2(e3, s3, n3), t3.memoizedState = pc2, r3) : (Ns2(t3), _c2(t3, c3));
    }
    if (l3 = e3.memoizedState, l3 !== null && (c3 = l3.dehydrated, c3 !== null)) {
      if (o3) t3.flags & 256 ? (Ns2(t3), t3.flags &= -257, t3 = yc2(e3, t3, n3)) : t3.memoizedState === null ? (Fs2(t3), a3 = r3.fallback, c3 = t3.mode, r3 = vc2({ mode: `visible`, children: r3.children }, c3), a3 = hi2(a3, c3, n3, null), a3.flags |= 2, r3.return = t3, a3.return = t3, r3.sibling = a3, t3.child = r3, As2(t3, e3.child, null, n3), r3 = t3.child, r3.memoizedState = mc2(n3), r3.childLanes = hc2(e3, s3, n3), t3.memoizedState = pc2, t3 = a3) : (Fs2(t3), t3.child = e3.child, t3.flags |= 128, t3 = null);
      else if (Ns2(t3), Gd2(c3)) {
        if (s3 = c3.nextSibling && c3.nextSibling.dataset, s3) var u3 = s3.dgst;
        s3 = u3, r3 = Error(i2(419)), r3.stack = ``, r3.digest = s3, Hi2({ value: r3, source: null, stack: null }), t3 = yc2(e3, t3, n3);
      } else if (tc2 || Xi2(e3, t3, n3, false), s3 = (n3 & e3.childLanes) !== 0, tc2 || s3) {
        if (s3 = U2, s3 !== null && (r3 = n3 & -n3, r3 = r3 & 42 ? 1 : nt2(r3), r3 = (r3 & (s3.suspendedLanes | n3)) === 0 ? r3 : 0, r3 !== 0 && r3 !== l3.retryLane)) throw l3.retryLane = r3, ai2(e3, r3), su2(s3, e3, r3), ec2;
        c3.data === `$?` || vu2(), t3 = yc2(e3, t3, n3);
      } else c3.data === `$?` ? (t3.flags |= 192, t3.child = e3.child, t3 = null) : (e3 = l3.treeContext, Mi2 = qd2(c3.nextSibling), ji2 = t3, I2 = true, Ni2 = null, Pi2 = false, e3 !== null && (Si2[Ci2++] = Ti2, Si2[Ci2++] = Ei2, Si2[Ci2++] = wi2, Ti2 = e3.id, Ei2 = e3.overflow, wi2 = t3), t3 = _c2(t3, r3.children), t3.flags |= 4096);
      return t3;
    }
    return a3 ? (Fs2(t3), a3 = r3.fallback, c3 = t3.mode, l3 = e3.child, u3 = l3.sibling, r3 = fi2(l3, { mode: `hidden`, children: r3.children }), r3.subtreeFlags = l3.subtreeFlags & 65011712, u3 === null ? (a3 = hi2(a3, c3, n3, null), a3.flags |= 2) : a3 = fi2(u3, a3), a3.return = t3, r3.return = t3, r3.sibling = a3, t3.child = r3, r3 = a3, a3 = t3.child, c3 = e3.child.memoizedState, c3 === null ? c3 = mc2(n3) : (l3 = c3.cachePool, l3 === null ? l3 = ya2() : (u3 = aa2._currentValue, l3 = l3.parent === u3 ? l3 : { parent: u3, pool: u3 }), c3 = { baseLanes: c3.baseLanes | n3, cachePool: l3 }), a3.memoizedState = c3, a3.childLanes = hc2(e3, s3, n3), t3.memoizedState = pc2, r3) : (Ns2(t3), n3 = e3.child, e3 = n3.sibling, n3 = fi2(n3, { mode: `visible`, children: r3.children }), n3.return = t3, n3.sibling = null, e3 !== null && (s3 = t3.deletions, s3 === null ? (t3.deletions = [e3], t3.flags |= 16) : s3.push(e3)), t3.child = n3, t3.memoizedState = null, n3);
  }
  function _c2(e3, t3) {
    return t3 = vc2({ mode: `visible`, children: t3 }, e3.mode), t3.return = e3, e3.child = t3;
  }
  function vc2(e3, t3) {
    return e3 = ui2(22, e3, null, t3), e3.lanes = 0, e3.stateNode = { _visibility: 1, _pendingMarkers: null, _retryCache: null, _transitions: null }, e3;
  }
  function yc2(e3, t3, n3) {
    return As2(t3, e3.child, null, n3), e3 = _c2(t3, t3.pendingProps.children), e3.flags |= 2, t3.memoizedState = null, e3;
  }
  function bc2(e3, t3, n3) {
    e3.lanes |= t3;
    var r3 = e3.alternate;
    r3 !== null && (r3.lanes |= t3), Ji2(e3.return, t3, n3);
  }
  function xc2(e3, t3, n3, r3, i3) {
    var a3 = e3.memoizedState;
    a3 === null ? e3.memoizedState = { isBackwards: t3, rendering: null, renderingStartTime: 0, last: r3, tail: n3, tailMode: i3 } : (a3.isBackwards = t3, a3.rendering = null, a3.renderingStartTime = 0, a3.last = r3, a3.tail = n3, a3.tailMode = i3);
  }
  function Sc2(e3, t3, n3) {
    var r3 = t3.pendingProps, i3 = r3.revealOrder, a3 = r3.tail;
    if (nc2(e3, t3, r3.children, n3), r3 = Ls2.current, r3 & 2) r3 = r3 & 1 | 2, t3.flags |= 128;
    else {
      if (e3 !== null && e3.flags & 128) a: for (e3 = t3.child; e3 !== null; ) {
        if (e3.tag === 13) e3.memoizedState !== null && bc2(e3, n3, t3);
        else if (e3.tag === 19) bc2(e3, n3, t3);
        else if (e3.child !== null) {
          e3.child.return = e3, e3 = e3.child;
          continue;
        }
        if (e3 === t3) break a;
        for (; e3.sibling === null; ) {
          if (e3.return === null || e3.return === t3) break a;
          e3 = e3.return;
        }
        e3.sibling.return = e3.return, e3 = e3.sibling;
      }
      r3 &= 1;
    }
    switch (D2(Ls2, r3), i3) {
      case `forwards`:
        for (n3 = t3.child, i3 = null; n3 !== null; ) e3 = n3.alternate, e3 !== null && Rs2(e3) === null && (i3 = n3), n3 = n3.sibling;
        n3 = i3, n3 === null ? (i3 = t3.child, t3.child = null) : (i3 = n3.sibling, n3.sibling = null), xc2(t3, false, i3, n3, a3);
        break;
      case `backwards`:
        for (n3 = null, i3 = t3.child, t3.child = null; i3 !== null; ) {
          if (e3 = i3.alternate, e3 !== null && Rs2(e3) === null) {
            t3.child = i3;
            break;
          }
          e3 = i3.sibling, i3.sibling = n3, n3 = i3, i3 = e3;
        }
        xc2(t3, true, n3, null, a3);
        break;
      case `together`:
        xc2(t3, false, null, null, void 0);
        break;
      default:
        t3.memoizedState = null;
    }
    return t3.child;
  }
  function Cc2(e3, t3, n3) {
    if (e3 !== null && (t3.dependencies = e3.dependencies), Rl2 |= t3.lanes, (n3 & t3.childLanes) === 0) if (e3 !== null) {
      if (Xi2(e3, t3, n3, false), (n3 & t3.childLanes) === 0) return null;
    } else return null;
    if (e3 !== null && t3.child !== e3.child) throw Error(i2(153));
    if (t3.child !== null) {
      for (e3 = t3.child, n3 = fi2(e3, e3.pendingProps), t3.child = n3, n3.return = t3; e3.sibling !== null; ) e3 = e3.sibling, n3 = n3.sibling = fi2(e3, e3.pendingProps), n3.return = t3;
      n3.sibling = null;
    }
    return t3.child;
  }
  function wc2(e3, t3) {
    return (e3.lanes & t3) === 0 ? (e3 = e3.dependencies, !!(e3 !== null && Zi2(e3))) : true;
  }
  function Tc2(e3, t3, n3) {
    switch (t3.tag) {
      case 3:
        _e2(t3, t3.stateNode.containerInfo), Ki2(t3, aa2, e3.memoizedState.cache), Bi2();
        break;
      case 27:
      case 5:
        be2(t3);
        break;
      case 4:
        _e2(t3, t3.stateNode.containerInfo);
        break;
      case 10:
        Ki2(t3, t3.type, t3.memoizedProps.value);
        break;
      case 13:
        var r3 = t3.memoizedState;
        if (r3 !== null) return r3.dehydrated === null ? (n3 & t3.child.childLanes) === 0 ? (Ns2(t3), e3 = Cc2(e3, t3, n3), e3 === null ? null : e3.sibling) : gc2(e3, t3, n3) : (Ns2(t3), t3.flags |= 128, null);
        Ns2(t3);
        break;
      case 19:
        var i3 = (e3.flags & 128) != 0;
        if (r3 = (n3 & t3.childLanes) !== 0, r3 ||= (Xi2(e3, t3, n3, false), (n3 & t3.childLanes) !== 0), i3) {
          if (r3) return Sc2(e3, t3, n3);
          t3.flags |= 128;
        }
        if (i3 = t3.memoizedState, i3 !== null && (i3.rendering = null, i3.tail = null, i3.lastEffect = null), D2(Ls2, Ls2.current), r3) break;
        return null;
      case 22:
      case 23:
        return t3.lanes = 0, oc2(e3, t3, n3);
      case 24:
        Ki2(t3, aa2, e3.memoizedState.cache);
    }
    return Cc2(e3, t3, n3);
  }
  function Ec2(e3, t3, n3) {
    if (e3 !== null) if (e3.memoizedProps !== t3.pendingProps) tc2 = true;
    else {
      if (!wc2(e3, n3) && !(t3.flags & 128)) return tc2 = false, Tc2(e3, t3, n3);
      tc2 = !!(e3.flags & 131072);
    }
    else tc2 = false, I2 && t3.flags & 1048576 && Oi2(t3, xi2, t3.index);
    switch (t3.lanes = 0, t3.tag) {
      case 16:
        a: {
          e3 = t3.pendingProps;
          var r3 = t3.elementType, a3 = r3._init;
          if (r3 = a3(r3._payload), t3.type = r3, typeof r3 == `function`) di2(r3) ? (e3 = Us2(r3, e3), t3.tag = 1, t3 = dc2(null, t3, r3, e3, n3)) : (t3.tag = 0, t3 = lc2(null, t3, r3, e3, n3));
          else {
            if (r3 != null) {
              if (a3 = r3.$$typeof, a3 === x2) {
                t3.tag = 11, t3 = rc2(null, t3, r3, e3, n3);
                break a;
              } else if (a3 === ee2) {
                t3.tag = 14, t3 = ic2(null, t3, r3, e3, n3);
                break a;
              }
            }
            throw t3 = se2(r3) || r3, Error(i2(306, t3, ``));
          }
        }
        return t3;
      case 0:
        return lc2(e3, t3, t3.type, t3.pendingProps, n3);
      case 1:
        return r3 = t3.type, a3 = Us2(r3, t3.pendingProps), dc2(e3, t3, r3, a3, n3);
      case 3:
        a: {
          if (_e2(t3, t3.stateNode.containerInfo), e3 === null) throw Error(i2(387));
          r3 = t3.pendingProps;
          var o3 = t3.memoizedState;
          a3 = o3.element, Ma2(e3, t3), za2(t3, r3, null, n3);
          var s3 = t3.memoizedState;
          if (r3 = s3.cache, Ki2(t3, aa2, r3), r3 !== o3.cache && Yi2(t3, [aa2], n3, true), Ra2(), r3 = s3.element, o3.isDehydrated) if (o3 = { element: r3, isDehydrated: false, cache: s3.cache }, t3.updateQueue.baseState = o3, t3.memoizedState = o3, t3.flags & 256) {
            t3 = fc2(e3, t3, r3, n3);
            break a;
          } else if (r3 !== a3) {
            a3 = Qr2(Error(i2(424)), t3), Hi2(a3), t3 = fc2(e3, t3, r3, n3);
            break a;
          } else {
            switch (e3 = t3.stateNode.containerInfo, e3.nodeType) {
              case 9:
                e3 = e3.body;
                break;
              default:
                e3 = e3.nodeName === `HTML` ? e3.ownerDocument.body : e3;
            }
            for (Mi2 = qd2(e3.firstChild), ji2 = t3, I2 = true, Ni2 = null, Pi2 = true, n3 = js2(t3, null, r3, n3), t3.child = n3; n3; ) n3.flags = n3.flags & -3 | 4096, n3 = n3.sibling;
          }
          else {
            if (Bi2(), r3 === a3) {
              t3 = Cc2(e3, t3, n3);
              break a;
            }
            nc2(e3, t3, r3, n3);
          }
          t3 = t3.child;
        }
        return t3;
      case 26:
        return cc2(e3, t3), e3 === null ? (n3 = mf2(t3.type, null, t3.pendingProps, null)) ? t3.memoizedState = n3 : I2 || (n3 = t3.type, e3 = t3.pendingProps, r3 = kd2(he2.current).createElement(n3), r3[st2] = t3, r3[ct2] = e3, Td2(r3, n3, e3), j2(r3), t3.stateNode = r3) : t3.memoizedState = mf2(t3.type, e3.memoizedProps, t3.pendingProps, e3.memoizedState), null;
      case 27:
        return be2(t3), e3 === null && I2 && (r3 = t3.stateNode = Xd2(t3.type, t3.pendingProps, he2.current), ji2 = t3, Pi2 = true, a3 = Mi2, Bd2(t3.type) ? (Jd2 = a3, Mi2 = qd2(r3.firstChild)) : Mi2 = a3), nc2(e3, t3, t3.pendingProps.children, n3), cc2(e3, t3), e3 === null && (t3.flags |= 4194304), t3.child;
      case 5:
        return e3 === null && I2 && ((a3 = r3 = Mi2) && (r3 = Ud2(r3, t3.type, t3.pendingProps, Pi2), r3 === null ? a3 = false : (t3.stateNode = r3, ji2 = t3, Mi2 = qd2(r3.firstChild), Pi2 = false, a3 = true)), a3 || Ii2(t3)), be2(t3), a3 = t3.type, o3 = t3.pendingProps, s3 = e3 === null ? null : e3.memoizedProps, r3 = o3.children, Md2(a3, o3) ? r3 = null : s3 !== null && Md2(a3, s3) && (t3.flags |= 32), t3.memoizedState !== null && (a3 = ro2(e3, t3, oo2, null, null, n3), Rf2._currentValue = a3), cc2(e3, t3), nc2(e3, t3, r3, n3), t3.child;
      case 6:
        return e3 === null && I2 && ((e3 = n3 = Mi2) && (n3 = Wd2(n3, t3.pendingProps, Pi2), n3 === null ? e3 = false : (t3.stateNode = n3, ji2 = t3, Mi2 = null, e3 = true)), e3 || Ii2(t3)), null;
      case 13:
        return gc2(e3, t3, n3);
      case 4:
        return _e2(t3, t3.stateNode.containerInfo), r3 = t3.pendingProps, e3 === null ? t3.child = As2(t3, null, r3, n3) : nc2(e3, t3, r3, n3), t3.child;
      case 11:
        return rc2(e3, t3, t3.type, t3.pendingProps, n3);
      case 7:
        return nc2(e3, t3, t3.pendingProps, n3), t3.child;
      case 8:
        return nc2(e3, t3, t3.pendingProps.children, n3), t3.child;
      case 12:
        return nc2(e3, t3, t3.pendingProps.children, n3), t3.child;
      case 10:
        return r3 = t3.pendingProps, Ki2(t3, t3.type, r3.value), nc2(e3, t3, r3.children, n3), t3.child;
      case 9:
        return a3 = t3.type._context, r3 = t3.pendingProps.children, Qi2(t3), a3 = $i2(a3), r3 = r3(a3), t3.flags |= 1, nc2(e3, t3, r3, n3), t3.child;
      case 14:
        return ic2(e3, t3, t3.type, t3.pendingProps, n3);
      case 15:
        return ac2(e3, t3, t3.type, t3.pendingProps, n3);
      case 19:
        return Sc2(e3, t3, n3);
      case 31:
        return r3 = t3.pendingProps, n3 = t3.mode, r3 = { mode: r3.mode, children: r3.children }, e3 === null ? (n3 = vc2(r3, n3), n3.ref = t3.ref, t3.child = n3, n3.return = t3, t3 = n3) : (n3 = fi2(e3.child, r3), n3.ref = t3.ref, t3.child = n3, n3.return = t3, t3 = n3), t3;
      case 22:
        return oc2(e3, t3, n3);
      case 24:
        return Qi2(t3), r3 = $i2(aa2), e3 === null ? (a3 = _a2(), a3 === null && (a3 = U2, o3 = oa2(), a3.pooledCache = o3, o3.refCount++, o3 !== null && (a3.pooledCacheLanes |= n3), a3 = o3), t3.memoizedState = { parent: r3, cache: a3 }, ja2(t3), Ki2(t3, aa2, a3)) : ((e3.lanes & n3) !== 0 && (Ma2(e3, t3), za2(t3, null, null, n3), Ra2()), a3 = e3.memoizedState, o3 = t3.memoizedState, a3.parent === r3 ? (r3 = o3.cache, Ki2(t3, aa2, r3), r3 !== a3.cache && Yi2(t3, [aa2], n3, true)) : (a3 = { parent: r3, cache: r3 }, t3.memoizedState = a3, t3.lanes === 0 && (t3.memoizedState = t3.updateQueue.baseState = a3), Ki2(t3, aa2, r3))), nc2(e3, t3, t3.pendingProps.children, n3), t3.child;
      case 29:
        throw t3.pendingProps;
    }
    throw Error(i2(156, t3.tag));
  }
  function Dc2(e3) {
    e3.flags |= 4;
  }
  function Oc2(e3, t3) {
    if (t3.type !== `stylesheet` || t3.state.loading & 4) e3.flags &= -16777217;
    else if (e3.flags |= 16777216, !kf2(t3)) {
      if (t3 = B2.current, t3 !== null && ((G2 & 4194048) === G2 ? Ms2 !== null : (G2 & 62914560) !== G2 && !(G2 & 536870912) || t3 !== Ms2)) throw Da2 = Ca2, xa2;
      e3.flags |= 8192;
    }
  }
  function kc2(e3, t3) {
    t3 !== null && (e3.flags |= 4), e3.flags & 16384 && (t3 = e3.tag === 22 ? 536870912 : Xe2(), e3.lanes |= t3, Hl2 |= t3);
  }
  function Ac2(e3, t3) {
    if (!I2) switch (e3.tailMode) {
      case `hidden`:
        t3 = e3.tail;
        for (var n3 = null; t3 !== null; ) t3.alternate !== null && (n3 = t3), t3 = t3.sibling;
        n3 === null ? e3.tail = null : n3.sibling = null;
        break;
      case `collapsed`:
        n3 = e3.tail;
        for (var r3 = null; n3 !== null; ) n3.alternate !== null && (r3 = n3), n3 = n3.sibling;
        r3 === null ? t3 || e3.tail === null ? e3.tail = null : e3.tail.sibling = null : r3.sibling = null;
    }
  }
  function jc2(e3) {
    var t3 = e3.alternate !== null && e3.alternate.child === e3.child, n3 = 0, r3 = 0;
    if (t3) for (var i3 = e3.child; i3 !== null; ) n3 |= i3.lanes | i3.childLanes, r3 |= i3.subtreeFlags & 65011712, r3 |= i3.flags & 65011712, i3.return = e3, i3 = i3.sibling;
    else for (i3 = e3.child; i3 !== null; ) n3 |= i3.lanes | i3.childLanes, r3 |= i3.subtreeFlags, r3 |= i3.flags, i3.return = e3, i3 = i3.sibling;
    return e3.subtreeFlags |= r3, e3.childLanes = n3, t3;
  }
  function Mc2(e3, t3, n3) {
    var r3 = t3.pendingProps;
    switch (Ai2(t3), t3.tag) {
      case 31:
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return jc2(t3), null;
      case 1:
        return jc2(t3), null;
      case 3:
        return n3 = t3.stateNode, r3 = null, e3 !== null && (r3 = e3.memoizedState.cache), t3.memoizedState.cache !== r3 && (t3.flags |= 2048), qi2(aa2), ve2(), n3.pendingContext && (n3.context = n3.pendingContext, n3.pendingContext = null), (e3 === null || e3.child === null) && (zi2(t3) ? Dc2(t3) : e3 === null || e3.memoizedState.isDehydrated && !(t3.flags & 256) || (t3.flags |= 1024, Vi2())), jc2(t3), null;
      case 26:
        return n3 = t3.memoizedState, e3 === null ? (Dc2(t3), n3 === null ? (jc2(t3), t3.flags &= -16777217) : (jc2(t3), Oc2(t3, n3))) : n3 ? n3 === e3.memoizedState ? (jc2(t3), t3.flags &= -16777217) : (Dc2(t3), jc2(t3), Oc2(t3, n3)) : (e3.memoizedProps !== r3 && Dc2(t3), jc2(t3), t3.flags &= -16777217), null;
      case 27:
        Se2(t3), n3 = he2.current;
        var a3 = t3.type;
        if (e3 !== null && t3.stateNode != null) e3.memoizedProps !== r3 && Dc2(t3);
        else {
          if (!r3) {
            if (t3.stateNode === null) throw Error(i2(166));
            return jc2(t3), null;
          }
          e3 = pe2.current, zi2(t3) ? Li2(t3, e3) : (e3 = Xd2(a3, r3, n3), t3.stateNode = e3, Dc2(t3));
        }
        return jc2(t3), null;
      case 5:
        if (Se2(t3), n3 = t3.type, e3 !== null && t3.stateNode != null) e3.memoizedProps !== r3 && Dc2(t3);
        else {
          if (!r3) {
            if (t3.stateNode === null) throw Error(i2(166));
            return jc2(t3), null;
          }
          if (e3 = pe2.current, zi2(t3)) Li2(t3, e3);
          else {
            switch (a3 = kd2(he2.current), e3) {
              case 1:
                e3 = a3.createElementNS(`http://www.w3.org/2000/svg`, n3);
                break;
              case 2:
                e3 = a3.createElementNS(`http://www.w3.org/1998/Math/MathML`, n3);
                break;
              default:
                switch (n3) {
                  case `svg`:
                    e3 = a3.createElementNS(`http://www.w3.org/2000/svg`, n3);
                    break;
                  case `math`:
                    e3 = a3.createElementNS(`http://www.w3.org/1998/Math/MathML`, n3);
                    break;
                  case `script`:
                    e3 = a3.createElement(`div`), e3.innerHTML = `<script><\/script>`, e3 = e3.removeChild(e3.firstChild);
                    break;
                  case `select`:
                    e3 = typeof r3.is == `string` ? a3.createElement(`select`, { is: r3.is }) : a3.createElement(`select`), r3.multiple ? e3.multiple = true : r3.size && (e3.size = r3.size);
                    break;
                  default:
                    e3 = typeof r3.is == `string` ? a3.createElement(n3, { is: r3.is }) : a3.createElement(n3);
                }
            }
            e3[st2] = t3, e3[ct2] = r3;
            a: for (a3 = t3.child; a3 !== null; ) {
              if (a3.tag === 5 || a3.tag === 6) e3.appendChild(a3.stateNode);
              else if (a3.tag !== 4 && a3.tag !== 27 && a3.child !== null) {
                a3.child.return = a3, a3 = a3.child;
                continue;
              }
              if (a3 === t3) break a;
              for (; a3.sibling === null; ) {
                if (a3.return === null || a3.return === t3) break a;
                a3 = a3.return;
              }
              a3.sibling.return = a3.return, a3 = a3.sibling;
            }
            t3.stateNode = e3;
            a: switch (Td2(e3, n3, r3), n3) {
              case `button`:
              case `input`:
              case `select`:
              case `textarea`:
                e3 = !!r3.autoFocus;
                break a;
              case `img`:
                e3 = true;
                break a;
              default:
                e3 = false;
            }
            e3 && Dc2(t3);
          }
        }
        return jc2(t3), t3.flags &= -16777217, null;
      case 6:
        if (e3 && t3.stateNode != null) e3.memoizedProps !== r3 && Dc2(t3);
        else {
          if (typeof r3 != `string` && t3.stateNode === null) throw Error(i2(166));
          if (e3 = he2.current, zi2(t3)) {
            if (e3 = t3.stateNode, n3 = t3.memoizedProps, r3 = null, a3 = ji2, a3 !== null) switch (a3.tag) {
              case 27:
              case 5:
                r3 = a3.memoizedProps;
            }
            e3[st2] = t3, e3 = !!(e3.nodeValue === n3 || r3 !== null && true === r3.suppressHydrationWarning || Sd2(e3.nodeValue, n3)), e3 || Ii2(t3);
          } else e3 = kd2(e3).createTextNode(r3), e3[st2] = t3, t3.stateNode = e3;
        }
        return jc2(t3), null;
      case 13:
        if (r3 = t3.memoizedState, e3 === null || e3.memoizedState !== null && e3.memoizedState.dehydrated !== null) {
          if (a3 = zi2(t3), r3 !== null && r3.dehydrated !== null) {
            if (e3 === null) {
              if (!a3) throw Error(i2(318));
              if (a3 = t3.memoizedState, a3 = a3 === null ? null : a3.dehydrated, !a3) throw Error(i2(317));
              a3[st2] = t3;
            } else Bi2(), !(t3.flags & 128) && (t3.memoizedState = null), t3.flags |= 4;
            jc2(t3), a3 = false;
          } else a3 = Vi2(), e3 !== null && e3.memoizedState !== null && (e3.memoizedState.hydrationErrors = a3), a3 = true;
          if (!a3) return t3.flags & 256 ? (Is2(t3), t3) : (Is2(t3), null);
        }
        if (Is2(t3), t3.flags & 128) return t3.lanes = n3, t3;
        if (n3 = r3 !== null, e3 = e3 !== null && e3.memoizedState !== null, n3) {
          r3 = t3.child, a3 = null, r3.alternate !== null && r3.alternate.memoizedState !== null && r3.alternate.memoizedState.cachePool !== null && (a3 = r3.alternate.memoizedState.cachePool.pool);
          var o3 = null;
          r3.memoizedState !== null && r3.memoizedState.cachePool !== null && (o3 = r3.memoizedState.cachePool.pool), o3 !== a3 && (r3.flags |= 2048);
        }
        return n3 !== e3 && n3 && (t3.child.flags |= 8192), kc2(t3, t3.updateQueue), jc2(t3), null;
      case 4:
        return ve2(), e3 === null && fd2(t3.stateNode.containerInfo), jc2(t3), null;
      case 10:
        return qi2(t3.type), jc2(t3), null;
      case 19:
        if (fe2(Ls2), a3 = t3.memoizedState, a3 === null) return jc2(t3), null;
        if (r3 = (t3.flags & 128) != 0, o3 = a3.rendering, o3 === null) if (r3) Ac2(a3, false);
        else {
          if (Ll2 !== 0 || e3 !== null && e3.flags & 128) for (e3 = t3.child; e3 !== null; ) {
            if (o3 = Rs2(e3), o3 !== null) {
              for (t3.flags |= 128, Ac2(a3, false), e3 = o3.updateQueue, t3.updateQueue = e3, kc2(t3, e3), t3.subtreeFlags = 0, e3 = n3, n3 = t3.child; n3 !== null; ) pi2(n3, e3), n3 = n3.sibling;
              return D2(Ls2, Ls2.current & 1 | 2), t3.child;
            }
            e3 = e3.sibling;
          }
          a3.tail !== null && Oe2() > ql2 && (t3.flags |= 128, r3 = true, Ac2(a3, false), t3.lanes = 4194304);
        }
        else {
          if (!r3) if (e3 = Rs2(o3), e3 !== null) {
            if (t3.flags |= 128, r3 = true, e3 = e3.updateQueue, t3.updateQueue = e3, kc2(t3, e3), Ac2(a3, true), a3.tail === null && a3.tailMode === `hidden` && !o3.alternate && !I2) return jc2(t3), null;
          } else 2 * Oe2() - a3.renderingStartTime > ql2 && n3 !== 536870912 && (t3.flags |= 128, r3 = true, Ac2(a3, false), t3.lanes = 4194304);
          a3.isBackwards ? (o3.sibling = t3.child, t3.child = o3) : (e3 = a3.last, e3 === null ? t3.child = o3 : e3.sibling = o3, a3.last = o3);
        }
        return a3.tail === null ? (jc2(t3), null) : (t3 = a3.tail, a3.rendering = t3, a3.tail = t3.sibling, a3.renderingStartTime = Oe2(), t3.sibling = null, e3 = Ls2.current, D2(Ls2, r3 ? e3 & 1 | 2 : e3 & 1), t3);
      case 22:
      case 23:
        return Is2(t3), Ka2(), r3 = t3.memoizedState !== null, e3 === null ? r3 && (t3.flags |= 8192) : e3.memoizedState !== null !== r3 && (t3.flags |= 8192), r3 ? n3 & 536870912 && !(t3.flags & 128) && (jc2(t3), t3.subtreeFlags & 6 && (t3.flags |= 8192)) : jc2(t3), n3 = t3.updateQueue, n3 !== null && kc2(t3, n3.retryQueue), n3 = null, e3 !== null && e3.memoizedState !== null && e3.memoizedState.cachePool !== null && (n3 = e3.memoizedState.cachePool.pool), r3 = null, t3.memoizedState !== null && t3.memoizedState.cachePool !== null && (r3 = t3.memoizedState.cachePool.pool), r3 !== n3 && (t3.flags |= 2048), e3 !== null && fe2(ga2), null;
      case 24:
        return n3 = null, e3 !== null && (n3 = e3.memoizedState.cache), t3.memoizedState.cache !== n3 && (t3.flags |= 2048), qi2(aa2), jc2(t3), null;
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(i2(156, t3.tag));
  }
  function Nc2(e3, t3) {
    switch (Ai2(t3), t3.tag) {
      case 1:
        return e3 = t3.flags, e3 & 65536 ? (t3.flags = e3 & -65537 | 128, t3) : null;
      case 3:
        return qi2(aa2), ve2(), e3 = t3.flags, e3 & 65536 && !(e3 & 128) ? (t3.flags = e3 & -65537 | 128, t3) : null;
      case 26:
      case 27:
      case 5:
        return Se2(t3), null;
      case 13:
        if (Is2(t3), e3 = t3.memoizedState, e3 !== null && e3.dehydrated !== null) {
          if (t3.alternate === null) throw Error(i2(340));
          Bi2();
        }
        return e3 = t3.flags, e3 & 65536 ? (t3.flags = e3 & -65537 | 128, t3) : null;
      case 19:
        return fe2(Ls2), null;
      case 4:
        return ve2(), null;
      case 10:
        return qi2(t3.type), null;
      case 22:
      case 23:
        return Is2(t3), Ka2(), e3 !== null && fe2(ga2), e3 = t3.flags, e3 & 65536 ? (t3.flags = e3 & -65537 | 128, t3) : null;
      case 24:
        return qi2(aa2), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function Pc2(e3, t3) {
    switch (Ai2(t3), t3.tag) {
      case 3:
        qi2(aa2), ve2();
        break;
      case 26:
      case 27:
      case 5:
        Se2(t3);
        break;
      case 4:
        ve2();
        break;
      case 13:
        Is2(t3);
        break;
      case 19:
        fe2(Ls2);
        break;
      case 10:
        qi2(t3.type);
        break;
      case 22:
      case 23:
        Is2(t3), Ka2(), e3 !== null && fe2(ga2);
        break;
      case 24:
        qi2(aa2);
    }
  }
  function Fc2(e3, t3) {
    try {
      var n3 = t3.updateQueue, r3 = n3 === null ? null : n3.lastEffect;
      if (r3 !== null) {
        var i3 = r3.next;
        n3 = i3;
        do {
          if ((n3.tag & e3) === e3) {
            r3 = void 0;
            var a3 = n3.create, o3 = n3.inst;
            r3 = a3(), o3.destroy = r3;
          }
          n3 = n3.next;
        } while (n3 !== i3);
      }
    } catch (e4) {
      q2(t3, t3.return, e4);
    }
  }
  function Ic2(e3, t3, n3) {
    try {
      var r3 = t3.updateQueue, i3 = r3 === null ? null : r3.lastEffect;
      if (i3 !== null) {
        var a3 = i3.next;
        r3 = a3;
        do {
          if ((r3.tag & e3) === e3) {
            var o3 = r3.inst, s3 = o3.destroy;
            if (s3 !== void 0) {
              o3.destroy = void 0, i3 = t3;
              var c3 = n3, l3 = s3;
              try {
                l3();
              } catch (e4) {
                q2(i3, c3, e4);
              }
            }
          }
          r3 = r3.next;
        } while (r3 !== a3);
      }
    } catch (e4) {
      q2(t3, t3.return, e4);
    }
  }
  function Lc2(e3) {
    var t3 = e3.updateQueue;
    if (t3 !== null) {
      var n3 = e3.stateNode;
      try {
        Va2(t3, n3);
      } catch (t4) {
        q2(e3, e3.return, t4);
      }
    }
  }
  function Rc2(e3, t3, n3) {
    n3.props = Us2(e3.type, e3.memoizedProps), n3.state = e3.memoizedState;
    try {
      n3.componentWillUnmount();
    } catch (n4) {
      q2(e3, t3, n4);
    }
  }
  function zc2(e3, t3) {
    try {
      var n3 = e3.ref;
      if (n3 !== null) {
        switch (e3.tag) {
          case 26:
          case 27:
          case 5:
            var r3 = e3.stateNode;
            break;
          case 30:
            r3 = e3.stateNode;
            break;
          default:
            r3 = e3.stateNode;
        }
        typeof n3 == `function` ? e3.refCleanup = n3(r3) : n3.current = r3;
      }
    } catch (n4) {
      q2(e3, t3, n4);
    }
  }
  function Bc2(e3, t3) {
    var n3 = e3.ref, r3 = e3.refCleanup;
    if (n3 !== null) if (typeof r3 == `function`) try {
      r3();
    } catch (n4) {
      q2(e3, t3, n4);
    } finally {
      e3.refCleanup = null, e3 = e3.alternate, e3 != null && (e3.refCleanup = null);
    }
    else if (typeof n3 == `function`) try {
      n3(null);
    } catch (n4) {
      q2(e3, t3, n4);
    }
    else n3.current = null;
  }
  function Vc2(e3) {
    var t3 = e3.type, n3 = e3.memoizedProps, r3 = e3.stateNode;
    try {
      a: switch (t3) {
        case `button`:
        case `input`:
        case `select`:
        case `textarea`:
          n3.autoFocus && r3.focus();
          break a;
        case `img`:
          n3.src ? r3.src = n3.src : n3.srcSet && (r3.srcset = n3.srcSet);
      }
    } catch (t4) {
      q2(e3, e3.return, t4);
    }
  }
  function Hc2(e3, t3, n3) {
    try {
      var r3 = e3.stateNode;
      Ed2(r3, e3.type, n3, t3), r3[ct2] = t3;
    } catch (t4) {
      q2(e3, e3.return, t4);
    }
  }
  function Uc2(e3) {
    return e3.tag === 5 || e3.tag === 3 || e3.tag === 26 || e3.tag === 27 && Bd2(e3.type) || e3.tag === 4;
  }
  function Wc2(e3) {
    a: for (; ; ) {
      for (; e3.sibling === null; ) {
        if (e3.return === null || Uc2(e3.return)) return null;
        e3 = e3.return;
      }
      for (e3.sibling.return = e3.return, e3 = e3.sibling; e3.tag !== 5 && e3.tag !== 6 && e3.tag !== 18; ) {
        if (e3.tag === 27 && Bd2(e3.type) || e3.flags & 2 || e3.child === null || e3.tag === 4) continue a;
        e3.child.return = e3, e3 = e3.child;
      }
      if (!(e3.flags & 2)) return e3.stateNode;
    }
  }
  function Gc2(e3, t3, n3) {
    var r3 = e3.tag;
    if (r3 === 5 || r3 === 6) e3 = e3.stateNode, t3 ? (n3.nodeType === 9 ? n3.body : n3.nodeName === `HTML` ? n3.ownerDocument.body : n3).insertBefore(e3, t3) : (t3 = n3.nodeType === 9 ? n3.body : n3.nodeName === `HTML` ? n3.ownerDocument.body : n3, t3.appendChild(e3), n3 = n3._reactRootContainer, n3 != null || t3.onclick !== null || (t3.onclick = Cd2));
    else if (r3 !== 4 && (r3 === 27 && Bd2(e3.type) && (n3 = e3.stateNode, t3 = null), e3 = e3.child, e3 !== null)) for (Gc2(e3, t3, n3), e3 = e3.sibling; e3 !== null; ) Gc2(e3, t3, n3), e3 = e3.sibling;
  }
  function Kc2(e3, t3, n3) {
    var r3 = e3.tag;
    if (r3 === 5 || r3 === 6) e3 = e3.stateNode, t3 ? n3.insertBefore(e3, t3) : n3.appendChild(e3);
    else if (r3 !== 4 && (r3 === 27 && Bd2(e3.type) && (n3 = e3.stateNode), e3 = e3.child, e3 !== null)) for (Kc2(e3, t3, n3), e3 = e3.sibling; e3 !== null; ) Kc2(e3, t3, n3), e3 = e3.sibling;
  }
  function qc2(e3) {
    var t3 = e3.stateNode, n3 = e3.memoizedProps;
    try {
      for (var r3 = e3.type, i3 = t3.attributes; i3.length; ) t3.removeAttributeNode(i3[0]);
      Td2(t3, r3, n3), t3[st2] = e3, t3[ct2] = n3;
    } catch (t4) {
      q2(e3, e3.return, t4);
    }
  }
  var Jc2 = false, Yc2 = false, Xc2 = false, Zc2 = typeof WeakSet == `function` ? WeakSet : Set, Qc2 = null;
  function $c2(e3, t3) {
    if (e3 = e3.containerInfo, Dd2 = Kf2, e3 = Or2(e3), kr2(e3)) {
      if (`selectionStart` in e3) var n3 = { start: e3.selectionStart, end: e3.selectionEnd };
      else a: {
        n3 = (n3 = e3.ownerDocument) && n3.defaultView || window;
        var r3 = n3.getSelection && n3.getSelection();
        if (r3 && r3.rangeCount !== 0) {
          n3 = r3.anchorNode;
          var a3 = r3.anchorOffset, o3 = r3.focusNode;
          r3 = r3.focusOffset;
          try {
            n3.nodeType, o3.nodeType;
          } catch {
            n3 = null;
            break a;
          }
          var s3 = 0, c3 = -1, l3 = -1, u3 = 0, d3 = 0, f3 = e3, p3 = null;
          b: for (; ; ) {
            for (var m3; f3 !== n3 || a3 !== 0 && f3.nodeType !== 3 || (c3 = s3 + a3), f3 !== o3 || r3 !== 0 && f3.nodeType !== 3 || (l3 = s3 + r3), f3.nodeType === 3 && (s3 += f3.nodeValue.length), (m3 = f3.firstChild) !== null; ) p3 = f3, f3 = m3;
            for (; ; ) {
              if (f3 === e3) break b;
              if (p3 === n3 && ++u3 === a3 && (c3 = s3), p3 === o3 && ++d3 === r3 && (l3 = s3), (m3 = f3.nextSibling) !== null) break;
              f3 = p3, p3 = f3.parentNode;
            }
            f3 = m3;
          }
          n3 = c3 === -1 || l3 === -1 ? null : { start: c3, end: l3 };
        } else n3 = null;
      }
      n3 ||= { start: 0, end: 0 };
    } else n3 = null;
    for (Od2 = { focusedElem: e3, selectionRange: n3 }, Kf2 = false, Qc2 = t3; Qc2 !== null; ) if (t3 = Qc2, e3 = t3.child, t3.subtreeFlags & 1024 && e3 !== null) e3.return = t3, Qc2 = e3;
    else for (; Qc2 !== null; ) {
      switch (t3 = Qc2, o3 = t3.alternate, e3 = t3.flags, t3.tag) {
        case 0:
          break;
        case 11:
        case 15:
          break;
        case 1:
          if (e3 & 1024 && o3 !== null) {
            e3 = void 0, n3 = t3, a3 = o3.memoizedProps, o3 = o3.memoizedState, r3 = n3.stateNode;
            try {
              var h3 = Us2(n3.type, a3, n3.elementType === n3.type);
              e3 = r3.getSnapshotBeforeUpdate(h3, o3), r3.__reactInternalSnapshotBeforeUpdate = e3;
            } catch (e4) {
              q2(n3, n3.return, e4);
            }
          }
          break;
        case 3:
          if (e3 & 1024) {
            if (e3 = t3.stateNode.containerInfo, n3 = e3.nodeType, n3 === 9) Hd2(e3);
            else if (n3 === 1) switch (e3.nodeName) {
              case `HEAD`:
              case `HTML`:
              case `BODY`:
                Hd2(e3);
                break;
              default:
                e3.textContent = ``;
            }
          }
          break;
        case 5:
        case 26:
        case 27:
        case 6:
        case 4:
        case 17:
          break;
        default:
          if (e3 & 1024) throw Error(i2(163));
      }
      if (e3 = t3.sibling, e3 !== null) {
        e3.return = t3.return, Qc2 = e3;
        break;
      }
      Qc2 = t3.return;
    }
  }
  function el2(e3, t3, n3) {
    var r3 = n3.flags;
    switch (n3.tag) {
      case 0:
      case 11:
      case 15:
        pl2(e3, n3), r3 & 4 && Fc2(5, n3);
        break;
      case 1:
        if (pl2(e3, n3), r3 & 4) if (e3 = n3.stateNode, t3 === null) try {
          e3.componentDidMount();
        } catch (e4) {
          q2(n3, n3.return, e4);
        }
        else {
          var i3 = Us2(n3.type, t3.memoizedProps);
          t3 = t3.memoizedState;
          try {
            e3.componentDidUpdate(i3, t3, e3.__reactInternalSnapshotBeforeUpdate);
          } catch (e4) {
            q2(n3, n3.return, e4);
          }
        }
        r3 & 64 && Lc2(n3), r3 & 512 && zc2(n3, n3.return);
        break;
      case 3:
        if (pl2(e3, n3), r3 & 64 && (e3 = n3.updateQueue, e3 !== null)) {
          if (t3 = null, n3.child !== null) switch (n3.child.tag) {
            case 27:
            case 5:
              t3 = n3.child.stateNode;
              break;
            case 1:
              t3 = n3.child.stateNode;
          }
          try {
            Va2(e3, t3);
          } catch (e4) {
            q2(n3, n3.return, e4);
          }
        }
        break;
      case 27:
        t3 === null && r3 & 4 && qc2(n3);
      case 26:
      case 5:
        pl2(e3, n3), t3 === null && r3 & 4 && Vc2(n3), r3 & 512 && zc2(n3, n3.return);
        break;
      case 12:
        pl2(e3, n3);
        break;
      case 13:
        pl2(e3, n3), r3 & 4 && al2(e3, n3), r3 & 64 && (e3 = n3.memoizedState, e3 !== null && (e3 = e3.dehydrated, e3 !== null && (n3 = zu2.bind(null, n3), Kd2(e3, n3))));
        break;
      case 22:
        if (r3 = n3.memoizedState !== null || Jc2, !r3) {
          t3 = t3 !== null && t3.memoizedState !== null || Yc2, i3 = Jc2;
          var a3 = Yc2;
          Jc2 = r3, (Yc2 = t3) && !a3 ? hl2(e3, n3, (n3.subtreeFlags & 8772) != 0) : pl2(e3, n3), Jc2 = i3, Yc2 = a3;
        }
        break;
      case 30:
        break;
      default:
        pl2(e3, n3);
    }
  }
  function tl2(e3) {
    var t3 = e3.alternate;
    t3 !== null && (e3.alternate = null, tl2(t3)), e3.child = null, e3.deletions = null, e3.sibling = null, e3.tag === 5 && (t3 = e3.stateNode, t3 !== null && ht2(t3)), e3.stateNode = null, e3.return = null, e3.dependencies = null, e3.memoizedProps = null, e3.memoizedState = null, e3.pendingProps = null, e3.stateNode = null, e3.updateQueue = null;
  }
  var nl2 = null, V2 = false;
  function rl2(e3, t3, n3) {
    for (n3 = n3.child; n3 !== null; ) il2(e3, t3, n3), n3 = n3.sibling;
  }
  function il2(e3, t3, n3) {
    if (Re2 && typeof Re2.onCommitFiberUnmount == `function`) try {
      Re2.onCommitFiberUnmount(Le2, n3);
    } catch {
    }
    switch (n3.tag) {
      case 26:
        Yc2 || Bc2(n3, t3), rl2(e3, t3, n3), n3.memoizedState ? n3.memoizedState.count-- : n3.stateNode && (n3 = n3.stateNode, n3.parentNode.removeChild(n3));
        break;
      case 27:
        Yc2 || Bc2(n3, t3);
        var r3 = nl2, i3 = V2;
        Bd2(n3.type) && (nl2 = n3.stateNode, V2 = false), rl2(e3, t3, n3), Zd2(n3.stateNode), nl2 = r3, V2 = i3;
        break;
      case 5:
        Yc2 || Bc2(n3, t3);
      case 6:
        if (r3 = nl2, i3 = V2, nl2 = null, rl2(e3, t3, n3), nl2 = r3, V2 = i3, nl2 !== null) if (V2) try {
          (nl2.nodeType === 9 ? nl2.body : nl2.nodeName === `HTML` ? nl2.ownerDocument.body : nl2).removeChild(n3.stateNode);
        } catch (e4) {
          q2(n3, t3, e4);
        }
        else try {
          nl2.removeChild(n3.stateNode);
        } catch (e4) {
          q2(n3, t3, e4);
        }
        break;
      case 18:
        nl2 !== null && (V2 ? (e3 = nl2, Vd2(e3.nodeType === 9 ? e3.body : e3.nodeName === `HTML` ? e3.ownerDocument.body : e3, n3.stateNode), vp2(e3)) : Vd2(nl2, n3.stateNode));
        break;
      case 4:
        r3 = nl2, i3 = V2, nl2 = n3.stateNode.containerInfo, V2 = true, rl2(e3, t3, n3), nl2 = r3, V2 = i3;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        Yc2 || Ic2(2, n3, t3), Yc2 || Ic2(4, n3, t3), rl2(e3, t3, n3);
        break;
      case 1:
        Yc2 || (Bc2(n3, t3), r3 = n3.stateNode, typeof r3.componentWillUnmount == `function` && Rc2(n3, t3, r3)), rl2(e3, t3, n3);
        break;
      case 21:
        rl2(e3, t3, n3);
        break;
      case 22:
        Yc2 = (r3 = Yc2) || n3.memoizedState !== null, rl2(e3, t3, n3), Yc2 = r3;
        break;
      default:
        rl2(e3, t3, n3);
    }
  }
  function al2(e3, t3) {
    if (t3.memoizedState === null && (e3 = t3.alternate, e3 !== null && (e3 = e3.memoizedState, e3 !== null && (e3 = e3.dehydrated, e3 !== null)))) try {
      vp2(e3);
    } catch (e4) {
      q2(t3, t3.return, e4);
    }
  }
  function ol2(e3) {
    switch (e3.tag) {
      case 13:
      case 19:
        var t3 = e3.stateNode;
        return t3 === null && (t3 = e3.stateNode = new Zc2()), t3;
      case 22:
        return e3 = e3.stateNode, t3 = e3._retryCache, t3 === null && (t3 = e3._retryCache = new Zc2()), t3;
      default:
        throw Error(i2(435, e3.tag));
    }
  }
  function sl2(e3, t3) {
    var n3 = ol2(e3);
    t3.forEach(function(t4) {
      var r3 = Bu2.bind(null, e3, t4);
      n3.has(t4) || (n3.add(t4), t4.then(r3, r3));
    });
  }
  function cl2(e3, t3) {
    var n3 = t3.deletions;
    if (n3 !== null) for (var r3 = 0; r3 < n3.length; r3++) {
      var a3 = n3[r3], o3 = e3, s3 = t3, c3 = s3;
      a: for (; c3 !== null; ) {
        switch (c3.tag) {
          case 27:
            if (Bd2(c3.type)) {
              nl2 = c3.stateNode, V2 = false;
              break a;
            }
            break;
          case 5:
            nl2 = c3.stateNode, V2 = false;
            break a;
          case 3:
          case 4:
            nl2 = c3.stateNode.containerInfo, V2 = true;
            break a;
        }
        c3 = c3.return;
      }
      if (nl2 === null) throw Error(i2(160));
      il2(o3, s3, a3), nl2 = null, V2 = false, o3 = a3.alternate, o3 !== null && (o3.return = null), a3.return = null;
    }
    if (t3.subtreeFlags & 13878) for (t3 = t3.child; t3 !== null; ) ul2(t3, e3), t3 = t3.sibling;
  }
  var ll2 = null;
  function ul2(e3, t3) {
    var n3 = e3.alternate, r3 = e3.flags;
    switch (e3.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        cl2(t3, e3), dl2(e3), r3 & 4 && (Ic2(3, e3, e3.return), Fc2(3, e3), Ic2(5, e3, e3.return));
        break;
      case 1:
        cl2(t3, e3), dl2(e3), r3 & 512 && (Yc2 || n3 === null || Bc2(n3, n3.return)), r3 & 64 && Jc2 && (e3 = e3.updateQueue, e3 !== null && (r3 = e3.callbacks, r3 !== null && (n3 = e3.shared.hiddenCallbacks, e3.shared.hiddenCallbacks = n3 === null ? r3 : n3.concat(r3))));
        break;
      case 26:
        var a3 = ll2;
        if (cl2(t3, e3), dl2(e3), r3 & 512 && (Yc2 || n3 === null || Bc2(n3, n3.return)), r3 & 4) {
          var o3 = n3 === null ? null : n3.memoizedState;
          if (r3 = e3.memoizedState, n3 === null) if (r3 === null) if (e3.stateNode === null) {
            a: {
              r3 = e3.type, n3 = e3.memoizedProps, a3 = a3.ownerDocument || a3;
              b: switch (r3) {
                case `title`:
                  o3 = a3.getElementsByTagName(`title`)[0], (!o3 || o3[mt2] || o3[st2] || o3.namespaceURI === `http://www.w3.org/2000/svg` || o3.hasAttribute(`itemprop`)) && (o3 = a3.createElement(r3), a3.head.insertBefore(o3, a3.querySelector(`head > title`))), Td2(o3, r3, n3), o3[st2] = e3, j2(o3), r3 = o3;
                  break a;
                case `link`:
                  var s3 = Ef2(`link`, `href`, a3).get(r3 + (n3.href || ``));
                  if (s3) {
                    for (var c3 = 0; c3 < s3.length; c3++) if (o3 = s3[c3], o3.getAttribute(`href`) === (n3.href == null || n3.href === `` ? null : n3.href) && o3.getAttribute(`rel`) === (n3.rel == null ? null : n3.rel) && o3.getAttribute(`title`) === (n3.title == null ? null : n3.title) && o3.getAttribute(`crossorigin`) === (n3.crossOrigin == null ? null : n3.crossOrigin)) {
                      s3.splice(c3, 1);
                      break b;
                    }
                  }
                  o3 = a3.createElement(r3), Td2(o3, r3, n3), a3.head.appendChild(o3);
                  break;
                case `meta`:
                  if (s3 = Ef2(`meta`, `content`, a3).get(r3 + (n3.content || ``))) {
                    for (c3 = 0; c3 < s3.length; c3++) if (o3 = s3[c3], o3.getAttribute(`content`) === (n3.content == null ? null : `` + n3.content) && o3.getAttribute(`name`) === (n3.name == null ? null : n3.name) && o3.getAttribute(`property`) === (n3.property == null ? null : n3.property) && o3.getAttribute(`http-equiv`) === (n3.httpEquiv == null ? null : n3.httpEquiv) && o3.getAttribute(`charset`) === (n3.charSet == null ? null : n3.charSet)) {
                      s3.splice(c3, 1);
                      break b;
                    }
                  }
                  o3 = a3.createElement(r3), Td2(o3, r3, n3), a3.head.appendChild(o3);
                  break;
                default:
                  throw Error(i2(468, r3));
              }
              o3[st2] = e3, j2(o3), r3 = o3;
            }
            e3.stateNode = r3;
          } else Df2(a3, e3.type, e3.stateNode);
          else e3.stateNode = xf2(a3, r3, e3.memoizedProps);
          else o3 === r3 ? r3 === null && e3.stateNode !== null && Hc2(e3, e3.memoizedProps, n3.memoizedProps) : (o3 === null ? n3.stateNode !== null && (n3 = n3.stateNode, n3.parentNode.removeChild(n3)) : o3.count--, r3 === null ? Df2(a3, e3.type, e3.stateNode) : xf2(a3, r3, e3.memoizedProps));
        }
        break;
      case 27:
        cl2(t3, e3), dl2(e3), r3 & 512 && (Yc2 || n3 === null || Bc2(n3, n3.return)), n3 !== null && r3 & 4 && Hc2(e3, e3.memoizedProps, n3.memoizedProps);
        break;
      case 5:
        if (cl2(t3, e3), dl2(e3), r3 & 512 && (Yc2 || n3 === null || Bc2(n3, n3.return)), e3.flags & 32) {
          a3 = e3.stateNode;
          try {
            N2(a3, ``);
          } catch (t4) {
            q2(e3, e3.return, t4);
          }
        }
        r3 & 4 && e3.stateNode != null && (a3 = e3.memoizedProps, Hc2(e3, a3, n3 === null ? a3 : n3.memoizedProps)), r3 & 1024 && (Xc2 = true);
        break;
      case 6:
        if (cl2(t3, e3), dl2(e3), r3 & 4) {
          if (e3.stateNode === null) throw Error(i2(162));
          r3 = e3.memoizedProps, n3 = e3.stateNode;
          try {
            n3.nodeValue = r3;
          } catch (t4) {
            q2(e3, e3.return, t4);
          }
        }
        break;
      case 3:
        if (Tf2 = null, a3 = ll2, ll2 = ef2(t3.containerInfo), cl2(t3, e3), ll2 = a3, dl2(e3), r3 & 4 && n3 !== null && n3.memoizedState.isDehydrated) try {
          vp2(t3.containerInfo);
        } catch (t4) {
          q2(e3, e3.return, t4);
        }
        Xc2 && (Xc2 = false, fl2(e3));
        break;
      case 4:
        r3 = ll2, ll2 = ef2(e3.stateNode.containerInfo), cl2(t3, e3), dl2(e3), ll2 = r3;
        break;
      case 12:
        cl2(t3, e3), dl2(e3);
        break;
      case 13:
        cl2(t3, e3), dl2(e3), e3.child.flags & 8192 && e3.memoizedState !== null != (n3 !== null && n3.memoizedState !== null) && (Kl2 = Oe2()), r3 & 4 && (r3 = e3.updateQueue, r3 !== null && (e3.updateQueue = null, sl2(e3, r3)));
        break;
      case 22:
        a3 = e3.memoizedState !== null;
        var l3 = n3 !== null && n3.memoizedState !== null, u3 = Jc2, d3 = Yc2;
        if (Jc2 = u3 || a3, Yc2 = d3 || l3, cl2(t3, e3), Yc2 = d3, Jc2 = u3, dl2(e3), r3 & 8192) a: for (t3 = e3.stateNode, t3._visibility = a3 ? t3._visibility & -2 : t3._visibility | 1, a3 && (n3 === null || l3 || Jc2 || Yc2 || ml2(e3)), n3 = null, t3 = e3; ; ) {
          if (t3.tag === 5 || t3.tag === 26) {
            if (n3 === null) {
              l3 = n3 = t3;
              try {
                if (o3 = l3.stateNode, a3) s3 = o3.style, typeof s3.setProperty == `function` ? s3.setProperty(`display`, `none`, `important`) : s3.display = `none`;
                else {
                  c3 = l3.stateNode;
                  var f3 = l3.memoizedProps.style, p3 = f3 != null && f3.hasOwnProperty(`display`) ? f3.display : null;
                  c3.style.display = p3 == null || typeof p3 == `boolean` ? `` : (`` + p3).trim();
                }
              } catch (e4) {
                q2(l3, l3.return, e4);
              }
            }
          } else if (t3.tag === 6) {
            if (n3 === null) {
              l3 = t3;
              try {
                l3.stateNode.nodeValue = a3 ? `` : l3.memoizedProps;
              } catch (e4) {
                q2(l3, l3.return, e4);
              }
            }
          } else if ((t3.tag !== 22 && t3.tag !== 23 || t3.memoizedState === null || t3 === e3) && t3.child !== null) {
            t3.child.return = t3, t3 = t3.child;
            continue;
          }
          if (t3 === e3) break a;
          for (; t3.sibling === null; ) {
            if (t3.return === null || t3.return === e3) break a;
            n3 === t3 && (n3 = null), t3 = t3.return;
          }
          n3 === t3 && (n3 = null), t3.sibling.return = t3.return, t3 = t3.sibling;
        }
        r3 & 4 && (r3 = e3.updateQueue, r3 !== null && (n3 = r3.retryQueue, n3 !== null && (r3.retryQueue = null, sl2(e3, n3))));
        break;
      case 19:
        cl2(t3, e3), dl2(e3), r3 & 4 && (r3 = e3.updateQueue, r3 !== null && (e3.updateQueue = null, sl2(e3, r3)));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        cl2(t3, e3), dl2(e3);
    }
  }
  function dl2(e3) {
    var t3 = e3.flags;
    if (t3 & 2) {
      try {
        for (var n3, r3 = e3.return; r3 !== null; ) {
          if (Uc2(r3)) {
            n3 = r3;
            break;
          }
          r3 = r3.return;
        }
        if (n3 == null) throw Error(i2(160));
        switch (n3.tag) {
          case 27:
            var a3 = n3.stateNode;
            Kc2(e3, Wc2(e3), a3);
            break;
          case 5:
            var o3 = n3.stateNode;
            n3.flags & 32 && (N2(o3, ``), n3.flags &= -33), Kc2(e3, Wc2(e3), o3);
            break;
          case 3:
          case 4:
            var s3 = n3.stateNode.containerInfo;
            Gc2(e3, Wc2(e3), s3);
            break;
          default:
            throw Error(i2(161));
        }
      } catch (t4) {
        q2(e3, e3.return, t4);
      }
      e3.flags &= -3;
    }
    t3 & 4096 && (e3.flags &= -4097);
  }
  function fl2(e3) {
    if (e3.subtreeFlags & 1024) for (e3 = e3.child; e3 !== null; ) {
      var t3 = e3;
      fl2(t3), t3.tag === 5 && t3.flags & 1024 && t3.stateNode.reset(), e3 = e3.sibling;
    }
  }
  function pl2(e3, t3) {
    if (t3.subtreeFlags & 8772) for (t3 = t3.child; t3 !== null; ) el2(e3, t3.alternate, t3), t3 = t3.sibling;
  }
  function ml2(e3) {
    for (e3 = e3.child; e3 !== null; ) {
      var t3 = e3;
      switch (t3.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          Ic2(4, t3, t3.return), ml2(t3);
          break;
        case 1:
          Bc2(t3, t3.return);
          var n3 = t3.stateNode;
          typeof n3.componentWillUnmount == `function` && Rc2(t3, t3.return, n3), ml2(t3);
          break;
        case 27:
          Zd2(t3.stateNode);
        case 26:
        case 5:
          Bc2(t3, t3.return), ml2(t3);
          break;
        case 22:
          t3.memoizedState === null && ml2(t3);
          break;
        case 30:
          ml2(t3);
          break;
        default:
          ml2(t3);
      }
      e3 = e3.sibling;
    }
  }
  function hl2(e3, t3, n3) {
    for (n3 &&= (t3.subtreeFlags & 8772) != 0, t3 = t3.child; t3 !== null; ) {
      var r3 = t3.alternate, i3 = e3, a3 = t3, o3 = a3.flags;
      switch (a3.tag) {
        case 0:
        case 11:
        case 15:
          hl2(i3, a3, n3), Fc2(4, a3);
          break;
        case 1:
          if (hl2(i3, a3, n3), r3 = a3, i3 = r3.stateNode, typeof i3.componentDidMount == `function`) try {
            i3.componentDidMount();
          } catch (e4) {
            q2(r3, r3.return, e4);
          }
          if (r3 = a3, i3 = r3.updateQueue, i3 !== null) {
            var s3 = r3.stateNode;
            try {
              var c3 = i3.shared.hiddenCallbacks;
              if (c3 !== null) for (i3.shared.hiddenCallbacks = null, i3 = 0; i3 < c3.length; i3++) Ba2(c3[i3], s3);
            } catch (e4) {
              q2(r3, r3.return, e4);
            }
          }
          n3 && o3 & 64 && Lc2(a3), zc2(a3, a3.return);
          break;
        case 27:
          qc2(a3);
        case 26:
        case 5:
          hl2(i3, a3, n3), n3 && r3 === null && o3 & 4 && Vc2(a3), zc2(a3, a3.return);
          break;
        case 12:
          hl2(i3, a3, n3);
          break;
        case 13:
          hl2(i3, a3, n3), n3 && o3 & 4 && al2(i3, a3);
          break;
        case 22:
          a3.memoizedState === null && hl2(i3, a3, n3), zc2(a3, a3.return);
          break;
        case 30:
          break;
        default:
          hl2(i3, a3, n3);
      }
      t3 = t3.sibling;
    }
  }
  function gl2(e3, t3) {
    var n3 = null;
    e3 !== null && e3.memoizedState !== null && e3.memoizedState.cachePool !== null && (n3 = e3.memoizedState.cachePool.pool), e3 = null, t3.memoizedState !== null && t3.memoizedState.cachePool !== null && (e3 = t3.memoizedState.cachePool.pool), e3 !== n3 && (e3 != null && e3.refCount++, n3 != null && sa2(n3));
  }
  function _l2(e3, t3) {
    e3 = null, t3.alternate !== null && (e3 = t3.alternate.memoizedState.cache), t3 = t3.memoizedState.cache, t3 !== e3 && (t3.refCount++, e3 != null && sa2(e3));
  }
  function vl2(e3, t3, n3, r3) {
    if (t3.subtreeFlags & 10256) for (t3 = t3.child; t3 !== null; ) yl2(e3, t3, n3, r3), t3 = t3.sibling;
  }
  function yl2(e3, t3, n3, r3) {
    var i3 = t3.flags;
    switch (t3.tag) {
      case 0:
      case 11:
      case 15:
        vl2(e3, t3, n3, r3), i3 & 2048 && Fc2(9, t3);
        break;
      case 1:
        vl2(e3, t3, n3, r3);
        break;
      case 3:
        vl2(e3, t3, n3, r3), i3 & 2048 && (e3 = null, t3.alternate !== null && (e3 = t3.alternate.memoizedState.cache), t3 = t3.memoizedState.cache, t3 !== e3 && (t3.refCount++, e3 != null && sa2(e3)));
        break;
      case 12:
        if (i3 & 2048) {
          vl2(e3, t3, n3, r3), e3 = t3.stateNode;
          try {
            var a3 = t3.memoizedProps, o3 = a3.id, s3 = a3.onPostCommit;
            typeof s3 == `function` && s3(o3, t3.alternate === null ? `mount` : `update`, e3.passiveEffectDuration, -0);
          } catch (e4) {
            q2(t3, t3.return, e4);
          }
        } else vl2(e3, t3, n3, r3);
        break;
      case 13:
        vl2(e3, t3, n3, r3);
        break;
      case 23:
        break;
      case 22:
        a3 = t3.stateNode, o3 = t3.alternate, t3.memoizedState === null ? a3._visibility & 2 ? vl2(e3, t3, n3, r3) : (a3._visibility |= 2, bl2(e3, t3, n3, r3, (t3.subtreeFlags & 10256) != 0)) : a3._visibility & 2 ? vl2(e3, t3, n3, r3) : xl2(e3, t3), i3 & 2048 && gl2(o3, t3);
        break;
      case 24:
        vl2(e3, t3, n3, r3), i3 & 2048 && _l2(t3.alternate, t3);
        break;
      default:
        vl2(e3, t3, n3, r3);
    }
  }
  function bl2(e3, t3, n3, r3, i3) {
    for (i3 &&= (t3.subtreeFlags & 10256) != 0, t3 = t3.child; t3 !== null; ) {
      var a3 = e3, o3 = t3, s3 = n3, c3 = r3, l3 = o3.flags;
      switch (o3.tag) {
        case 0:
        case 11:
        case 15:
          bl2(a3, o3, s3, c3, i3), Fc2(8, o3);
          break;
        case 23:
          break;
        case 22:
          var u3 = o3.stateNode;
          o3.memoizedState === null ? (u3._visibility |= 2, bl2(a3, o3, s3, c3, i3)) : u3._visibility & 2 ? bl2(a3, o3, s3, c3, i3) : xl2(a3, o3), i3 && l3 & 2048 && gl2(o3.alternate, o3);
          break;
        case 24:
          bl2(a3, o3, s3, c3, i3), i3 && l3 & 2048 && _l2(o3.alternate, o3);
          break;
        default:
          bl2(a3, o3, s3, c3, i3);
      }
      t3 = t3.sibling;
    }
  }
  function xl2(e3, t3) {
    if (t3.subtreeFlags & 10256) for (t3 = t3.child; t3 !== null; ) {
      var n3 = e3, r3 = t3, i3 = r3.flags;
      switch (r3.tag) {
        case 22:
          xl2(n3, r3), i3 & 2048 && gl2(r3.alternate, r3);
          break;
        case 24:
          xl2(n3, r3), i3 & 2048 && _l2(r3.alternate, r3);
          break;
        default:
          xl2(n3, r3);
      }
      t3 = t3.sibling;
    }
  }
  var Sl2 = 8192;
  function Cl2(e3) {
    if (e3.subtreeFlags & Sl2) for (e3 = e3.child; e3 !== null; ) wl2(e3), e3 = e3.sibling;
  }
  function wl2(e3) {
    switch (e3.tag) {
      case 26:
        Cl2(e3), e3.flags & Sl2 && e3.memoizedState !== null && Mf2(ll2, e3.memoizedState, e3.memoizedProps);
        break;
      case 5:
        Cl2(e3);
        break;
      case 3:
      case 4:
        var t3 = ll2;
        ll2 = ef2(e3.stateNode.containerInfo), Cl2(e3), ll2 = t3;
        break;
      case 22:
        e3.memoizedState === null && (t3 = e3.alternate, t3 !== null && t3.memoizedState !== null ? (t3 = Sl2, Sl2 = 16777216, Cl2(e3), Sl2 = t3) : Cl2(e3));
        break;
      default:
        Cl2(e3);
    }
  }
  function Tl2(e3) {
    var t3 = e3.alternate;
    if (t3 !== null && (e3 = t3.child, e3 !== null)) {
      t3.child = null;
      do
        t3 = e3.sibling, e3.sibling = null, e3 = t3;
      while (e3 !== null);
    }
  }
  function El2(e3) {
    var t3 = e3.deletions;
    if (e3.flags & 16) {
      if (t3 !== null) for (var n3 = 0; n3 < t3.length; n3++) {
        var r3 = t3[n3];
        Qc2 = r3, kl2(r3, e3);
      }
      Tl2(e3);
    }
    if (e3.subtreeFlags & 10256) for (e3 = e3.child; e3 !== null; ) Dl2(e3), e3 = e3.sibling;
  }
  function Dl2(e3) {
    switch (e3.tag) {
      case 0:
      case 11:
      case 15:
        El2(e3), e3.flags & 2048 && Ic2(9, e3, e3.return);
        break;
      case 3:
        El2(e3);
        break;
      case 12:
        El2(e3);
        break;
      case 22:
        var t3 = e3.stateNode;
        e3.memoizedState !== null && t3._visibility & 2 && (e3.return === null || e3.return.tag !== 13) ? (t3._visibility &= -3, Ol2(e3)) : El2(e3);
        break;
      default:
        El2(e3);
    }
  }
  function Ol2(e3) {
    var t3 = e3.deletions;
    if (e3.flags & 16) {
      if (t3 !== null) for (var n3 = 0; n3 < t3.length; n3++) {
        var r3 = t3[n3];
        Qc2 = r3, kl2(r3, e3);
      }
      Tl2(e3);
    }
    for (e3 = e3.child; e3 !== null; ) {
      switch (t3 = e3, t3.tag) {
        case 0:
        case 11:
        case 15:
          Ic2(8, t3, t3.return), Ol2(t3);
          break;
        case 22:
          n3 = t3.stateNode, n3._visibility & 2 && (n3._visibility &= -3, Ol2(t3));
          break;
        default:
          Ol2(t3);
      }
      e3 = e3.sibling;
    }
  }
  function kl2(e3, t3) {
    for (; Qc2 !== null; ) {
      var n3 = Qc2;
      switch (n3.tag) {
        case 0:
        case 11:
        case 15:
          Ic2(8, n3, t3);
          break;
        case 23:
        case 22:
          if (n3.memoizedState !== null && n3.memoizedState.cachePool !== null) {
            var r3 = n3.memoizedState.cachePool.pool;
            r3 != null && r3.refCount++;
          }
          break;
        case 24:
          sa2(n3.memoizedState.cache);
      }
      if (r3 = n3.child, r3 !== null) r3.return = n3, Qc2 = r3;
      else a: for (n3 = e3; Qc2 !== null; ) {
        r3 = Qc2;
        var i3 = r3.sibling, a3 = r3.return;
        if (tl2(r3), r3 === n3) {
          Qc2 = null;
          break a;
        }
        if (i3 !== null) {
          i3.return = a3, Qc2 = i3;
          break a;
        }
        Qc2 = a3;
      }
    }
  }
  var Al2 = { getCacheForType: function(e3) {
    var t3 = $i2(aa2), n3 = t3.data.get(e3);
    return n3 === void 0 && (n3 = e3(), t3.data.set(e3, n3)), n3;
  } }, jl2 = typeof WeakMap == `function` ? WeakMap : Map, H2 = 0, U2 = null, W2 = null, G2 = 0, K2 = 0, Ml2 = null, Nl2 = false, Pl2 = false, Fl2 = false, Il2 = 0, Ll2 = 0, Rl2 = 0, zl2 = 0, Bl2 = 0, Vl2 = 0, Hl2 = 0, Ul2 = null, Wl2 = null, Gl2 = false, Kl2 = 0, ql2 = 1 / 0, Jl2 = null, Yl2 = null, Xl2 = 0, Zl2 = null, Ql2 = null, $l2 = 0, eu2 = 0, tu2 = null, nu2 = null, ru2 = 0, iu2 = null;
  function au2() {
    if (H2 & 2 && G2 !== 0) return G2 & -G2;
    if (w2.T !== null) {
      var e3 = ua2;
      return e3 === 0 ? nd2() : e3;
    }
    return it2();
  }
  function ou2() {
    Vl2 === 0 && (Vl2 = !(G2 & 536870912) || I2 ? Ye2() : 536870912);
    var e3 = B2.current;
    return e3 !== null && (e3.flags |= 32), Vl2;
  }
  function su2(e3, t3, n3) {
    (e3 === U2 && (K2 === 2 || K2 === 9) || e3.cancelPendingCommit !== null) && (mu2(e3, 0), du2(e3, G2, Vl2, false)), Qe2(e3, n3), (!(H2 & 2) || e3 !== U2) && (e3 === U2 && (!(H2 & 2) && (zl2 |= n3), Ll2 === 4 && du2(e3, G2, Vl2, false)), Ju2(e3));
  }
  function cu2(e3, t3, n3) {
    if (H2 & 6) throw Error(i2(327));
    var r3 = !n3 && (t3 & 124) == 0 && (t3 & e3.expiredLanes) === 0 || qe2(e3, t3), a3 = r3 ? xu2(e3, t3) : yu2(e3, t3, true), o3 = r3;
    do {
      if (a3 === 0) {
        Pl2 && !r3 && du2(e3, t3, 0, false);
        break;
      } else {
        if (n3 = e3.current.alternate, o3 && !uu2(n3)) {
          a3 = yu2(e3, t3, false), o3 = false;
          continue;
        }
        if (a3 === 2) {
          if (o3 = t3, e3.errorRecoveryDisabledLanes & o3) var s3 = 0;
          else s3 = e3.pendingLanes & -536870913, s3 = s3 === 0 ? s3 & 536870912 ? 536870912 : 0 : s3;
          if (s3 !== 0) {
            t3 = s3;
            a: {
              var c3 = e3;
              a3 = Ul2;
              var l3 = c3.current.memoizedState.isDehydrated;
              if (l3 && (mu2(c3, s3).flags |= 256), s3 = yu2(c3, s3, false), s3 !== 2) {
                if (Fl2 && !l3) {
                  c3.errorRecoveryDisabledLanes |= o3, zl2 |= o3, a3 = 4;
                  break a;
                }
                o3 = Wl2, Wl2 = a3, o3 !== null && (Wl2 === null ? Wl2 = o3 : Wl2.push.apply(Wl2, o3));
              }
              a3 = s3;
            }
            if (o3 = false, a3 !== 2) continue;
          }
        }
        if (a3 === 1) {
          mu2(e3, 0), du2(e3, t3, 0, true);
          break;
        }
        a: {
          switch (r3 = e3, o3 = a3, o3) {
            case 0:
            case 1:
              throw Error(i2(345));
            case 4:
              if ((t3 & 4194048) !== t3) break;
            case 6:
              du2(r3, t3, Vl2, !Nl2);
              break a;
            case 2:
              Wl2 = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(i2(329));
          }
          if ((t3 & 62914560) === t3 && (a3 = Kl2 + 300 - Oe2(), 10 < a3)) {
            if (du2(r3, t3, Vl2, !Nl2), Ke2(r3, 0, true) !== 0) break a;
            r3.timeoutHandle = Fd2(lu2.bind(null, r3, n3, Wl2, Jl2, Gl2, t3, Vl2, zl2, Hl2, Nl2, o3, 2, -0, 0), a3);
            break a;
          }
          lu2(r3, n3, Wl2, Jl2, Gl2, t3, Vl2, zl2, Hl2, Nl2, o3, 0, -0, 0);
        }
      }
      break;
    } while (1);
    Ju2(e3);
  }
  function lu2(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3) {
    if (e3.timeoutHandle = -1, d3 = t3.subtreeFlags, (d3 & 8192 || (d3 & 16785408) == 16785408) && (Af2 = { stylesheets: null, count: 0, unsuspend: jf2 }, wl2(t3), d3 = Nf2(), d3 !== null)) {
      e3.cancelPendingCommit = d3(Ou2.bind(null, e3, t3, a3, n3, r3, i3, o3, s3, c3, u3, 1, f3, p3)), du2(e3, a3, o3, !l3);
      return;
    }
    Ou2(e3, t3, a3, n3, r3, i3, o3, s3, c3);
  }
  function uu2(e3) {
    for (var t3 = e3; ; ) {
      var n3 = t3.tag;
      if ((n3 === 0 || n3 === 11 || n3 === 15) && t3.flags & 16384 && (n3 = t3.updateQueue, n3 !== null && (n3 = n3.stores, n3 !== null))) for (var r3 = 0; r3 < n3.length; r3++) {
        var i3 = n3[r3], a3 = i3.getSnapshot;
        i3 = i3.value;
        try {
          if (!Cr2(a3(), i3)) return false;
        } catch {
          return false;
        }
      }
      if (n3 = t3.child, t3.subtreeFlags & 16384 && n3 !== null) n3.return = t3, t3 = n3;
      else {
        if (t3 === e3) break;
        for (; t3.sibling === null; ) {
          if (t3.return === null || t3.return === e3) return true;
          t3 = t3.return;
        }
        t3.sibling.return = t3.return, t3 = t3.sibling;
      }
    }
    return true;
  }
  function du2(e3, t3, n3, r3) {
    t3 &= ~Bl2, t3 &= ~zl2, e3.suspendedLanes |= t3, e3.pingedLanes &= ~t3, r3 && (e3.warmLanes |= t3), r3 = e3.expirationTimes;
    for (var i3 = t3; 0 < i3; ) {
      var a3 = 31 - k2(i3), o3 = 1 << a3;
      r3[a3] = -1, i3 &= ~o3;
    }
    n3 !== 0 && et2(e3, n3, t3);
  }
  function fu2() {
    return H2 & 6 ? true : (Yu2(0, false), false);
  }
  function pu2() {
    if (W2 !== null) {
      if (K2 === 0) var e3 = W2.return;
      else e3 = W2, Gi2 = Wi2 = null, lo2(e3), Cs2 = null, ws2 = 0, e3 = W2;
      for (; e3 !== null; ) Pc2(e3.alternate, e3), e3 = e3.return;
      W2 = null;
    }
  }
  function mu2(e3, t3) {
    var n3 = e3.timeoutHandle;
    n3 !== -1 && (e3.timeoutHandle = -1, Id2(n3)), n3 = e3.cancelPendingCommit, n3 !== null && (e3.cancelPendingCommit = null, n3()), pu2(), U2 = e3, W2 = n3 = fi2(e3.current, null), G2 = t3, K2 = 0, Ml2 = null, Nl2 = false, Pl2 = qe2(e3, t3), Fl2 = false, Hl2 = Vl2 = Bl2 = zl2 = Rl2 = Ll2 = 0, Wl2 = Ul2 = null, Gl2 = false, t3 & 8 && (t3 |= t3 & 32);
    var r3 = e3.entangledLanes;
    if (r3 !== 0) for (e3 = e3.entanglements, r3 &= t3; 0 < r3; ) {
      var i3 = 31 - k2(r3), a3 = 1 << i3;
      t3 |= e3[i3], r3 &= ~a3;
    }
    return Il2 = t3, ni2(), n3;
  }
  function hu2(e3, t3) {
    L2 = null, w2.H = ys2, t3 === ba2 || t3 === Sa2 ? (t3 = Oa2(), K2 = 3) : t3 === xa2 ? (t3 = Oa2(), K2 = 4) : K2 = t3 === ec2 ? 8 : typeof t3 == `object` && t3 && typeof t3.then == `function` ? 6 : 1, Ml2 = t3, W2 === null && (Ll2 = 1, Js2(e3, Qr2(t3, e3.current)));
  }
  function gu2() {
    var e3 = w2.H;
    return w2.H = ys2, e3 === null ? ys2 : e3;
  }
  function _u2() {
    var e3 = w2.A;
    return w2.A = Al2, e3;
  }
  function vu2() {
    Ll2 = 4, Nl2 || (G2 & 4194048) !== G2 && B2.current !== null || (Pl2 = true), !(Rl2 & 134217727) && !(zl2 & 134217727) || U2 === null || du2(U2, G2, Vl2, false);
  }
  function yu2(e3, t3, n3) {
    var r3 = H2;
    H2 |= 2;
    var i3 = gu2(), a3 = _u2();
    (U2 !== e3 || G2 !== t3) && (Jl2 = null, mu2(e3, t3)), t3 = false;
    var o3 = Ll2;
    a: do
      try {
        if (K2 !== 0 && W2 !== null) {
          var s3 = W2, c3 = Ml2;
          switch (K2) {
            case 8:
              pu2(), o3 = 6;
              break a;
            case 3:
            case 2:
            case 9:
            case 6:
              B2.current === null && (t3 = true);
              var l3 = K2;
              if (K2 = 0, Ml2 = null, Tu2(e3, s3, c3, l3), n3 && Pl2) {
                o3 = 0;
                break a;
              }
              break;
            default:
              l3 = K2, K2 = 0, Ml2 = null, Tu2(e3, s3, c3, l3);
          }
        }
        bu2(), o3 = Ll2;
        break;
      } catch (t4) {
        hu2(e3, t4);
      }
    while (1);
    return t3 && e3.shellSuspendCounter++, Gi2 = Wi2 = null, H2 = r3, w2.H = i3, w2.A = a3, W2 === null && (U2 = null, G2 = 0, ni2()), o3;
  }
  function bu2() {
    for (; W2 !== null; ) Cu2(W2);
  }
  function xu2(e3, t3) {
    var n3 = H2;
    H2 |= 2;
    var r3 = gu2(), a3 = _u2();
    U2 !== e3 || G2 !== t3 ? (Jl2 = null, ql2 = Oe2() + 500, mu2(e3, t3)) : Pl2 = qe2(e3, t3);
    a: do
      try {
        if (K2 !== 0 && W2 !== null) {
          t3 = W2;
          var o3 = Ml2;
          b: switch (K2) {
            case 1:
              K2 = 0, Ml2 = null, Tu2(e3, t3, o3, 1);
              break;
            case 2:
            case 9:
              if (wa2(o3)) {
                K2 = 0, Ml2 = null, wu2(t3);
                break;
              }
              t3 = function() {
                K2 !== 2 && K2 !== 9 || U2 !== e3 || (K2 = 7), Ju2(e3);
              }, o3.then(t3, t3);
              break a;
            case 3:
              K2 = 7;
              break a;
            case 4:
              K2 = 5;
              break a;
            case 7:
              wa2(o3) ? (K2 = 0, Ml2 = null, wu2(t3)) : (K2 = 0, Ml2 = null, Tu2(e3, t3, o3, 7));
              break;
            case 5:
              var s3 = null;
              switch (W2.tag) {
                case 26:
                  s3 = W2.memoizedState;
                case 5:
                case 27:
                  var c3 = W2;
                  if (!s3 || kf2(s3)) {
                    K2 = 0, Ml2 = null;
                    var l3 = c3.sibling;
                    if (l3 !== null) W2 = l3;
                    else {
                      var u3 = c3.return;
                      u3 === null ? W2 = null : (W2 = u3, Eu2(u3));
                    }
                    break b;
                  }
              }
              K2 = 0, Ml2 = null, Tu2(e3, t3, o3, 5);
              break;
            case 6:
              K2 = 0, Ml2 = null, Tu2(e3, t3, o3, 6);
              break;
            case 8:
              pu2(), Ll2 = 6;
              break a;
            default:
              throw Error(i2(462));
          }
        }
        Su2();
        break;
      } catch (t4) {
        hu2(e3, t4);
      }
    while (1);
    return Gi2 = Wi2 = null, w2.H = r3, w2.A = a3, H2 = n3, W2 === null ? (U2 = null, G2 = 0, ni2(), Ll2) : 0;
  }
  function Su2() {
    for (; W2 !== null && !De2(); ) Cu2(W2);
  }
  function Cu2(e3) {
    var t3 = Ec2(e3.alternate, e3, Il2);
    e3.memoizedProps = e3.pendingProps, t3 === null ? Eu2(e3) : W2 = t3;
  }
  function wu2(e3) {
    var t3 = e3, n3 = t3.alternate;
    switch (t3.tag) {
      case 15:
      case 0:
        t3 = uc2(n3, t3, t3.pendingProps, t3.type, void 0, G2);
        break;
      case 11:
        t3 = uc2(n3, t3, t3.pendingProps, t3.type.render, t3.ref, G2);
        break;
      case 5:
        lo2(t3);
      default:
        Pc2(n3, t3), t3 = W2 = pi2(t3, Il2), t3 = Ec2(n3, t3, Il2);
    }
    e3.memoizedProps = e3.pendingProps, t3 === null ? Eu2(e3) : W2 = t3;
  }
  function Tu2(e3, t3, n3, r3) {
    Gi2 = Wi2 = null, lo2(t3), Cs2 = null, ws2 = 0;
    var i3 = t3.return;
    try {
      if ($s2(e3, i3, t3, n3, G2)) {
        Ll2 = 1, Js2(e3, Qr2(n3, e3.current)), W2 = null;
        return;
      }
    } catch (t4) {
      if (i3 !== null) throw W2 = i3, t4;
      Ll2 = 1, Js2(e3, Qr2(n3, e3.current)), W2 = null;
      return;
    }
    t3.flags & 32768 ? (I2 || r3 === 1 ? e3 = true : Pl2 || G2 & 536870912 ? e3 = false : (Nl2 = e3 = true, (r3 === 2 || r3 === 9 || r3 === 3 || r3 === 6) && (r3 = B2.current, r3 !== null && r3.tag === 13 && (r3.flags |= 16384))), Du2(t3, e3)) : Eu2(t3);
  }
  function Eu2(e3) {
    var t3 = e3;
    do {
      if (t3.flags & 32768) {
        Du2(t3, Nl2);
        return;
      }
      e3 = t3.return;
      var n3 = Mc2(t3.alternate, t3, Il2);
      if (n3 !== null) {
        W2 = n3;
        return;
      }
      if (t3 = t3.sibling, t3 !== null) {
        W2 = t3;
        return;
      }
      W2 = t3 = e3;
    } while (t3 !== null);
    Ll2 === 0 && (Ll2 = 5);
  }
  function Du2(e3, t3) {
    do {
      var n3 = Nc2(e3.alternate, e3);
      if (n3 !== null) {
        n3.flags &= 32767, W2 = n3;
        return;
      }
      if (n3 = e3.return, n3 !== null && (n3.flags |= 32768, n3.subtreeFlags = 0, n3.deletions = null), !t3 && (e3 = e3.sibling, e3 !== null)) {
        W2 = e3;
        return;
      }
      W2 = e3 = n3;
    } while (e3 !== null);
    Ll2 = 6, W2 = null;
  }
  function Ou2(e3, t3, n3, r3, a3, o3, s3, c3, l3) {
    e3.cancelPendingCommit = null;
    do
      Nu2();
    while (Xl2 !== 0);
    if (H2 & 6) throw Error(i2(327));
    if (t3 !== null) {
      if (t3 === e3.current) throw Error(i2(177));
      if (o3 = t3.lanes | t3.childLanes, o3 |= ti2, $e2(e3, n3, o3, s3, c3, l3), e3 === U2 && (W2 = U2 = null, G2 = 0), Ql2 = t3, Zl2 = e3, $l2 = n3, eu2 = o3, tu2 = a3, nu2 = r3, t3.subtreeFlags & 10256 || t3.flags & 10256 ? (e3.callbackNode = null, e3.callbackPriority = 0, Vu2(Me2, function() {
        return Pu2(true), null;
      })) : (e3.callbackNode = null, e3.callbackPriority = 0), r3 = (t3.flags & 13878) != 0, t3.subtreeFlags & 13878 || r3) {
        r3 = w2.T, w2.T = null, a3 = T2.p, T2.p = 2, s3 = H2, H2 |= 4;
        try {
          $c2(e3, t3, n3);
        } finally {
          H2 = s3, T2.p = a3, w2.T = r3;
        }
      }
      Xl2 = 1, ku2(), Au2(), ju2();
    }
  }
  function ku2() {
    if (Xl2 === 1) {
      Xl2 = 0;
      var e3 = Zl2, t3 = Ql2, n3 = (t3.flags & 13878) != 0;
      if (t3.subtreeFlags & 13878 || n3) {
        n3 = w2.T, w2.T = null;
        var r3 = T2.p;
        T2.p = 2;
        var i3 = H2;
        H2 |= 4;
        try {
          ul2(t3, e3);
          var a3 = Od2, o3 = Or2(e3.containerInfo), s3 = a3.focusedElem, c3 = a3.selectionRange;
          if (o3 !== s3 && s3 && s3.ownerDocument && Dr2(s3.ownerDocument.documentElement, s3)) {
            if (c3 !== null && kr2(s3)) {
              var l3 = c3.start, u3 = c3.end;
              if (u3 === void 0 && (u3 = l3), `selectionStart` in s3) s3.selectionStart = l3, s3.selectionEnd = Math.min(u3, s3.value.length);
              else {
                var d3 = s3.ownerDocument || document, f3 = d3 && d3.defaultView || window;
                if (f3.getSelection) {
                  var p3 = f3.getSelection(), m3 = s3.textContent.length, h3 = Math.min(c3.start, m3), g3 = c3.end === void 0 ? h3 : Math.min(c3.end, m3);
                  !p3.extend && h3 > g3 && (o3 = g3, g3 = h3, h3 = o3);
                  var _3 = Er2(s3, h3), v3 = Er2(s3, g3);
                  if (_3 && v3 && (p3.rangeCount !== 1 || p3.anchorNode !== _3.node || p3.anchorOffset !== _3.offset || p3.focusNode !== v3.node || p3.focusOffset !== v3.offset)) {
                    var y3 = d3.createRange();
                    y3.setStart(_3.node, _3.offset), p3.removeAllRanges(), h3 > g3 ? (p3.addRange(y3), p3.extend(v3.node, v3.offset)) : (y3.setEnd(v3.node, v3.offset), p3.addRange(y3));
                  }
                }
              }
            }
            for (d3 = [], p3 = s3; p3 = p3.parentNode; ) p3.nodeType === 1 && d3.push({ element: p3, left: p3.scrollLeft, top: p3.scrollTop });
            for (typeof s3.focus == `function` && s3.focus(), s3 = 0; s3 < d3.length; s3++) {
              var b3 = d3[s3];
              b3.element.scrollLeft = b3.left, b3.element.scrollTop = b3.top;
            }
          }
          Kf2 = !!Dd2, Od2 = Dd2 = null;
        } finally {
          H2 = i3, T2.p = r3, w2.T = n3;
        }
      }
      e3.current = t3, Xl2 = 2;
    }
  }
  function Au2() {
    if (Xl2 === 2) {
      Xl2 = 0;
      var e3 = Zl2, t3 = Ql2, n3 = (t3.flags & 8772) != 0;
      if (t3.subtreeFlags & 8772 || n3) {
        n3 = w2.T, w2.T = null;
        var r3 = T2.p;
        T2.p = 2;
        var i3 = H2;
        H2 |= 4;
        try {
          el2(e3, t3.alternate, t3);
        } finally {
          H2 = i3, T2.p = r3, w2.T = n3;
        }
      }
      Xl2 = 3;
    }
  }
  function ju2() {
    if (Xl2 === 4 || Xl2 === 3) {
      Xl2 = 0, O2();
      var e3 = Zl2, t3 = Ql2, n3 = $l2, r3 = nu2;
      t3.subtreeFlags & 10256 || t3.flags & 10256 ? Xl2 = 5 : (Xl2 = 0, Ql2 = Zl2 = null, Mu2(e3, e3.pendingLanes));
      var i3 = e3.pendingLanes;
      if (i3 === 0 && (Yl2 = null), rt2(n3), t3 = t3.stateNode, Re2 && typeof Re2.onCommitFiberRoot == `function`) try {
        Re2.onCommitFiberRoot(Le2, t3, void 0, (t3.current.flags & 128) == 128);
      } catch {
      }
      if (r3 !== null) {
        t3 = w2.T, i3 = T2.p, T2.p = 2, w2.T = null;
        try {
          for (var a3 = e3.onRecoverableError, o3 = 0; o3 < r3.length; o3++) {
            var s3 = r3[o3];
            a3(s3.value, { componentStack: s3.stack });
          }
        } finally {
          w2.T = t3, T2.p = i3;
        }
      }
      $l2 & 3 && Nu2(), Ju2(e3), i3 = e3.pendingLanes, n3 & 4194090 && i3 & 42 ? e3 === iu2 ? ru2++ : (ru2 = 0, iu2 = e3) : ru2 = 0, Yu2(0, false);
    }
  }
  function Mu2(e3, t3) {
    (e3.pooledCacheLanes &= t3) === 0 && (t3 = e3.pooledCache, t3 != null && (e3.pooledCache = null, sa2(t3)));
  }
  function Nu2(e3) {
    return ku2(), Au2(), ju2(), Pu2(e3);
  }
  function Pu2() {
    if (Xl2 !== 5) return false;
    var e3 = Zl2, t3 = eu2;
    eu2 = 0;
    var n3 = rt2($l2), r3 = w2.T, a3 = T2.p;
    try {
      T2.p = 32 > n3 ? 32 : n3, w2.T = null, n3 = tu2, tu2 = null;
      var o3 = Zl2, s3 = $l2;
      if (Xl2 = 0, Ql2 = Zl2 = null, $l2 = 0, H2 & 6) throw Error(i2(331));
      var c3 = H2;
      if (H2 |= 4, Dl2(o3.current), yl2(o3, o3.current, s3, n3), H2 = c3, Yu2(0, false), Re2 && typeof Re2.onPostCommitFiberRoot == `function`) try {
        Re2.onPostCommitFiberRoot(Le2, o3);
      } catch {
      }
      return true;
    } finally {
      T2.p = a3, w2.T = r3, Mu2(e3, t3);
    }
  }
  function Fu2(e3, t3, n3) {
    t3 = Qr2(n3, t3), t3 = Xs2(e3.stateNode, t3, 2), e3 = Pa2(e3, t3, 2), e3 !== null && (Qe2(e3, 2), Ju2(e3));
  }
  function q2(e3, t3, n3) {
    if (e3.tag === 3) Fu2(e3, e3, n3);
    else for (; t3 !== null; ) {
      if (t3.tag === 3) {
        Fu2(t3, e3, n3);
        break;
      } else if (t3.tag === 1) {
        var r3 = t3.stateNode;
        if (typeof t3.type.getDerivedStateFromError == `function` || typeof r3.componentDidCatch == `function` && (Yl2 === null || !Yl2.has(r3))) {
          e3 = Qr2(n3, e3), n3 = Zs2(2), r3 = Pa2(t3, n3, 2), r3 !== null && (Qs2(n3, r3, t3, e3), Qe2(r3, 2), Ju2(r3));
          break;
        }
      }
      t3 = t3.return;
    }
  }
  function Iu2(e3, t3, n3) {
    var r3 = e3.pingCache;
    if (r3 === null) {
      r3 = e3.pingCache = new jl2();
      var i3 = /* @__PURE__ */ new Set();
      r3.set(t3, i3);
    } else i3 = r3.get(t3), i3 === void 0 && (i3 = /* @__PURE__ */ new Set(), r3.set(t3, i3));
    i3.has(n3) || (Fl2 = true, i3.add(n3), e3 = Lu2.bind(null, e3, t3, n3), t3.then(e3, e3));
  }
  function Lu2(e3, t3, n3) {
    var r3 = e3.pingCache;
    r3 !== null && r3.delete(t3), e3.pingedLanes |= e3.suspendedLanes & n3, e3.warmLanes &= ~n3, U2 === e3 && (G2 & n3) === n3 && (Ll2 === 4 || Ll2 === 3 && (G2 & 62914560) === G2 && 300 > Oe2() - Kl2 ? !(H2 & 2) && mu2(e3, 0) : Bl2 |= n3, Hl2 === G2 && (Hl2 = 0)), Ju2(e3);
  }
  function Ru2(e3, t3) {
    t3 === 0 && (t3 = Xe2()), e3 = ai2(e3, t3), e3 !== null && (Qe2(e3, t3), Ju2(e3));
  }
  function zu2(e3) {
    var t3 = e3.memoizedState, n3 = 0;
    t3 !== null && (n3 = t3.retryLane), Ru2(e3, n3);
  }
  function Bu2(e3, t3) {
    var n3 = 0;
    switch (e3.tag) {
      case 13:
        var r3 = e3.stateNode, a3 = e3.memoizedState;
        a3 !== null && (n3 = a3.retryLane);
        break;
      case 19:
        r3 = e3.stateNode;
        break;
      case 22:
        r3 = e3.stateNode._retryCache;
        break;
      default:
        throw Error(i2(314));
    }
    r3 !== null && r3.delete(t3), Ru2(e3, n3);
  }
  function Vu2(e3, t3) {
    return Te2(e3, t3);
  }
  var Hu2 = null, Uu2 = null, Wu2 = false, Gu2 = false, Ku2 = false, qu2 = 0;
  function Ju2(e3) {
    e3 !== Uu2 && e3.next === null && (Uu2 === null ? Hu2 = Uu2 = e3 : Uu2 = Uu2.next = e3), Gu2 = true, Wu2 || (Wu2 = true, td2());
  }
  function Yu2(e3, t3) {
    if (!Ku2 && Gu2) {
      Ku2 = true;
      do
        for (var n3 = false, r3 = Hu2; r3 !== null; ) {
          if (!t3) if (e3 !== 0) {
            var i3 = r3.pendingLanes;
            if (i3 === 0) var a3 = 0;
            else {
              var o3 = r3.suspendedLanes, s3 = r3.pingedLanes;
              a3 = (1 << 31 - k2(42 | e3) + 1) - 1, a3 &= i3 & ~(o3 & ~s3), a3 = a3 & 201326741 ? a3 & 201326741 | 1 : a3 ? a3 | 2 : 0;
            }
            a3 !== 0 && (n3 = true, ed2(r3, a3));
          } else a3 = G2, a3 = Ke2(r3, r3 === U2 ? a3 : 0, r3.cancelPendingCommit !== null || r3.timeoutHandle !== -1), !(a3 & 3) || qe2(r3, a3) || (n3 = true, ed2(r3, a3));
          r3 = r3.next;
        }
      while (n3);
      Ku2 = false;
    }
  }
  function Xu2() {
    Zu2();
  }
  function Zu2() {
    Gu2 = Wu2 = false;
    var e3 = 0;
    qu2 !== 0 && (Pd2() && (e3 = qu2), qu2 = 0);
    for (var t3 = Oe2(), n3 = null, r3 = Hu2; r3 !== null; ) {
      var i3 = r3.next, a3 = Qu2(r3, t3);
      a3 === 0 ? (r3.next = null, n3 === null ? Hu2 = i3 : n3.next = i3, i3 === null && (Uu2 = n3)) : (n3 = r3, (e3 !== 0 || a3 & 3) && (Gu2 = true)), r3 = i3;
    }
    Yu2(e3, false);
  }
  function Qu2(e3, t3) {
    for (var n3 = e3.suspendedLanes, r3 = e3.pingedLanes, i3 = e3.expirationTimes, a3 = e3.pendingLanes & -62914561; 0 < a3; ) {
      var o3 = 31 - k2(a3), s3 = 1 << o3, c3 = i3[o3];
      c3 === -1 ? ((s3 & n3) === 0 || (s3 & r3) !== 0) && (i3[o3] = Je2(s3, t3)) : c3 <= t3 && (e3.expiredLanes |= s3), a3 &= ~s3;
    }
    if (t3 = U2, n3 = G2, n3 = Ke2(e3, e3 === t3 ? n3 : 0, e3.cancelPendingCommit !== null || e3.timeoutHandle !== -1), r3 = e3.callbackNode, n3 === 0 || e3 === t3 && (K2 === 2 || K2 === 9) || e3.cancelPendingCommit !== null) return r3 !== null && r3 !== null && Ee2(r3), e3.callbackNode = null, e3.callbackPriority = 0;
    if (!(n3 & 3) || qe2(e3, n3)) {
      if (t3 = n3 & -n3, t3 === e3.callbackPriority) return t3;
      switch (r3 !== null && Ee2(r3), rt2(n3)) {
        case 2:
        case 8:
          n3 = je2;
          break;
        case 32:
          n3 = Me2;
          break;
        case 268435456:
          n3 = Pe2;
          break;
        default:
          n3 = Me2;
      }
      return r3 = $u2.bind(null, e3), n3 = Te2(n3, r3), e3.callbackPriority = t3, e3.callbackNode = n3, t3;
    }
    return r3 !== null && r3 !== null && Ee2(r3), e3.callbackPriority = 2, e3.callbackNode = null, 2;
  }
  function $u2(e3, t3) {
    if (Xl2 !== 0 && Xl2 !== 5) return e3.callbackNode = null, e3.callbackPriority = 0, null;
    var n3 = e3.callbackNode;
    if (Nu2(true) && e3.callbackNode !== n3) return null;
    var r3 = G2;
    return r3 = Ke2(e3, e3 === U2 ? r3 : 0, e3.cancelPendingCommit !== null || e3.timeoutHandle !== -1), r3 === 0 ? null : (cu2(e3, r3, t3), Qu2(e3, Oe2()), e3.callbackNode != null && e3.callbackNode === n3 ? $u2.bind(null, e3) : null);
  }
  function ed2(e3, t3) {
    if (Nu2()) return null;
    cu2(e3, t3, true);
  }
  function td2() {
    Rd2(function() {
      H2 & 6 ? Te2(Ae2, Xu2) : Zu2();
    });
  }
  function nd2() {
    return qu2 === 0 && (qu2 = Ye2()), qu2;
  }
  function rd2(e3) {
    return e3 == null || typeof e3 == `symbol` || typeof e3 == `boolean` ? null : typeof e3 == `function` ? e3 : nn2(`` + e3);
  }
  function id2(e3, t3) {
    var n3 = t3.ownerDocument.createElement(`input`);
    return n3.name = t3.name, n3.value = t3.value, e3.id && n3.setAttribute(`form`, e3.id), t3.parentNode.insertBefore(n3, t3), e3 = new FormData(e3), n3.parentNode.removeChild(n3), e3;
  }
  function ad2(e3, t3, n3, r3, i3) {
    if (t3 === `submit` && n3 && n3.stateNode === i3) {
      var a3 = rd2((i3[ct2] || null).action), o3 = r3.submitter;
      o3 && (t3 = (t3 = o3[ct2] || null) ? rd2(t3.formAction) : o3.getAttribute(`formAction`), t3 !== null && (a3 = t3, o3 = null));
      var s3 = new Cn2(`action`, `action`, null, r3, i3);
      e3.push({ event: s3, listeners: [{ instance: null, listener: function() {
        if (r3.defaultPrevented) {
          if (qu2 !== 0) {
            var e4 = o3 ? id2(i3, o3) : new FormData(i3);
            as2(n3, { pending: true, data: e4, method: i3.method, action: a3 }, null, e4);
          }
        } else typeof a3 == `function` && (s3.preventDefault(), e4 = o3 ? id2(i3, o3) : new FormData(i3), as2(n3, { pending: true, data: e4, method: i3.method, action: a3 }, a3, e4));
      }, currentTarget: i3 }] });
    }
  }
  for (var od2 = 0; od2 < Yr2.length; od2++) {
    var sd2 = Yr2[od2];
    Xr2(sd2.toLowerCase(), `on` + (sd2[0].toUpperCase() + sd2.slice(1)));
  }
  Xr2(Vr2, `onAnimationEnd`), Xr2(Hr2, `onAnimationIteration`), Xr2(Ur2, `onAnimationStart`), Xr2(`dblclick`, `onDoubleClick`), Xr2(`focusin`, `onFocus`), Xr2(`focusout`, `onBlur`), Xr2(Wr2, `onTransitionRun`), Xr2(Gr2, `onTransitionStart`), Xr2(Kr2, `onTransitionCancel`), Xr2(qr2, `onTransitionEnd`), St2(`onMouseEnter`, [`mouseout`, `mouseover`]), St2(`onMouseLeave`, [`mouseout`, `mouseover`]), St2(`onPointerEnter`, [`pointerout`, `pointerover`]), St2(`onPointerLeave`, [`pointerout`, `pointerover`]), xt2(`onChange`, `change click focusin focusout input keydown keyup selectionchange`.split(` `)), xt2(`onSelect`, `focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange`.split(` `)), xt2(`onBeforeInput`, [`compositionend`, `keypress`, `textInput`, `paste`]), xt2(`onCompositionEnd`, `compositionend focusout keydown keypress keyup mousedown`.split(` `)), xt2(`onCompositionStart`, `compositionstart focusout keydown keypress keyup mousedown`.split(` `)), xt2(`onCompositionUpdate`, `compositionupdate focusout keydown keypress keyup mousedown`.split(` `));
  var cd2 = `abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting`.split(` `), ld2 = new Set(`beforetoggle cancel close invalid load scroll scrollend toggle`.split(` `).concat(cd2));
  function J2(e3, t3) {
    t3 = (t3 & 4) != 0;
    for (var n3 = 0; n3 < e3.length; n3++) {
      var r3 = e3[n3], i3 = r3.event;
      r3 = r3.listeners;
      a: {
        var a3 = void 0;
        if (t3) for (var o3 = r3.length - 1; 0 <= o3; o3--) {
          var s3 = r3[o3], c3 = s3.instance, l3 = s3.currentTarget;
          if (s3 = s3.listener, c3 !== a3 && i3.isPropagationStopped()) break a;
          a3 = s3, i3.currentTarget = l3;
          try {
            a3(i3);
          } catch (e4) {
            Ws2(e4);
          }
          i3.currentTarget = null, a3 = c3;
        }
        else for (o3 = 0; o3 < r3.length; o3++) {
          if (s3 = r3[o3], c3 = s3.instance, l3 = s3.currentTarget, s3 = s3.listener, c3 !== a3 && i3.isPropagationStopped()) break a;
          a3 = s3, i3.currentTarget = l3;
          try {
            a3(i3);
          } catch (e4) {
            Ws2(e4);
          }
          i3.currentTarget = null, a3 = c3;
        }
      }
    }
  }
  function Y2(e3, t3) {
    var n3 = t3[ut2];
    n3 === void 0 && (n3 = t3[ut2] = /* @__PURE__ */ new Set());
    var r3 = e3 + `__bubble`;
    n3.has(r3) || (pd2(t3, e3, 2, false), n3.add(r3));
  }
  function ud2(e3, t3, n3) {
    var r3 = 0;
    t3 && (r3 |= 4), pd2(n3, e3, r3, t3);
  }
  var dd2 = `_reactListening` + Math.random().toString(36).slice(2);
  function fd2(e3) {
    if (!e3[dd2]) {
      e3[dd2] = true, yt2.forEach(function(t4) {
        t4 !== `selectionchange` && (ld2.has(t4) || ud2(t4, false, e3), ud2(t4, true, e3));
      });
      var t3 = e3.nodeType === 9 ? e3 : e3.ownerDocument;
      t3 === null || t3[dd2] || (t3[dd2] = true, ud2(`selectionchange`, false, t3));
    }
  }
  function pd2(e3, t3, n3, r3) {
    switch ($f2(t3)) {
      case 2:
        var i3 = qf2;
        break;
      case 8:
        i3 = Jf2;
        break;
      default:
        i3 = Yf2;
    }
    n3 = i3.bind(null, t3, n3, e3), i3 = void 0, !pn2 || t3 !== `touchstart` && t3 !== `touchmove` && t3 !== `wheel` || (i3 = true), r3 ? i3 === void 0 ? e3.addEventListener(t3, n3, true) : e3.addEventListener(t3, n3, { capture: true, passive: i3 }) : i3 === void 0 ? e3.addEventListener(t3, n3, false) : e3.addEventListener(t3, n3, { passive: i3 });
  }
  function md2(e3, t3, n3, r3, i3) {
    var a3 = r3;
    if (!(t3 & 1) && !(t3 & 2) && r3 !== null) a: for (; ; ) {
      if (r3 === null) return;
      var s3 = r3.tag;
      if (s3 === 3 || s3 === 4) {
        var c3 = r3.stateNode.containerInfo;
        if (c3 === i3) break;
        if (s3 === 4) for (s3 = r3.return; s3 !== null; ) {
          var l3 = s3.tag;
          if ((l3 === 3 || l3 === 4) && s3.stateNode.containerInfo === i3) return;
          s3 = s3.return;
        }
        for (; c3 !== null; ) {
          if (s3 = gt2(c3), s3 === null) return;
          if (l3 = s3.tag, l3 === 5 || l3 === 6 || l3 === 26 || l3 === 27) {
            r3 = a3 = s3;
            continue a;
          }
          c3 = c3.parentNode;
        }
      }
      r3 = r3.return;
    }
    un2(function() {
      var r4 = a3, i4 = an2(n3), s4 = [];
      a: {
        var c4 = Jr2.get(e3);
        if (c4 !== void 0) {
          var l4 = Cn2, u3 = e3;
          switch (e3) {
            case `keypress`:
              if (vn2(n3) === 0) break a;
            case `keydown`:
            case `keyup`:
              l4 = Bn2;
              break;
            case `focusin`:
              u3 = `focus`, l4 = Mn2;
              break;
            case `focusout`:
              u3 = `blur`, l4 = Mn2;
              break;
            case `beforeblur`:
            case `afterblur`:
              l4 = Mn2;
              break;
            case `click`:
              if (n3.button === 2) break a;
            case `auxclick`:
            case `dblclick`:
            case `mousedown`:
            case `mousemove`:
            case `mouseup`:
            case `mouseout`:
            case `mouseover`:
            case `contextmenu`:
              l4 = An2;
              break;
            case `drag`:
            case `dragend`:
            case `dragenter`:
            case `dragexit`:
            case `dragleave`:
            case `dragover`:
            case `dragstart`:
            case `drop`:
              l4 = jn2;
              break;
            case `touchcancel`:
            case `touchend`:
            case `touchmove`:
            case `touchstart`:
              l4 = Hn2;
              break;
            case Vr2:
            case Hr2:
            case Ur2:
              l4 = Nn2;
              break;
            case qr2:
              l4 = Un2;
              break;
            case `scroll`:
            case `scrollend`:
              l4 = Tn2;
              break;
            case `wheel`:
              l4 = Wn2;
              break;
            case `copy`:
            case `cut`:
            case `paste`:
              l4 = Pn2;
              break;
            case `gotpointercapture`:
            case `lostpointercapture`:
            case `pointercancel`:
            case `pointerdown`:
            case `pointermove`:
            case `pointerout`:
            case `pointerover`:
            case `pointerup`:
              l4 = Vn2;
              break;
            case `toggle`:
            case `beforetoggle`:
              l4 = Gn2;
          }
          var d3 = (t3 & 4) != 0, f3 = !d3 && (e3 === `scroll` || e3 === `scrollend`), p3 = d3 ? c4 === null ? null : c4 + `Capture` : c4;
          d3 = [];
          for (var m3 = r4, h3; m3 !== null; ) {
            var g3 = m3;
            if (h3 = g3.stateNode, g3 = g3.tag, g3 !== 5 && g3 !== 26 && g3 !== 27 || h3 === null || p3 === null || (g3 = dn2(m3, p3), g3 != null && d3.push(hd2(m3, g3, h3))), f3) break;
            m3 = m3.return;
          }
          0 < d3.length && (c4 = new l4(c4, u3, null, n3, i4), s4.push({ event: c4, listeners: d3 }));
        }
      }
      if (!(t3 & 7)) {
        a: {
          if (c4 = e3 === `mouseover` || e3 === `pointerover`, l4 = e3 === `mouseout` || e3 === `pointerout`, c4 && n3 !== rn2 && (u3 = n3.relatedTarget || n3.fromElement) && (gt2(u3) || u3[lt2])) break a;
          if ((l4 || c4) && (c4 = i4.window === i4 ? i4 : (c4 = i4.ownerDocument) ? c4.defaultView || c4.parentWindow : window, l4 ? (u3 = n3.relatedTarget || n3.toElement, l4 = r4, u3 = u3 ? gt2(u3) : null, u3 !== null && (f3 = o2(u3), d3 = u3.tag, u3 !== f3 || d3 !== 5 && d3 !== 27 && d3 !== 6) && (u3 = null)) : (l4 = null, u3 = r4), l4 !== u3)) {
            if (d3 = An2, g3 = `onMouseLeave`, p3 = `onMouseEnter`, m3 = `mouse`, (e3 === `pointerout` || e3 === `pointerover`) && (d3 = Vn2, g3 = `onPointerLeave`, p3 = `onPointerEnter`, m3 = `pointer`), f3 = l4 == null ? c4 : A2(l4), h3 = u3 == null ? c4 : A2(u3), c4 = new d3(g3, m3 + `leave`, l4, n3, i4), c4.target = f3, c4.relatedTarget = h3, g3 = null, gt2(i4) === r4 && (d3 = new d3(p3, m3 + `enter`, u3, n3, i4), d3.target = h3, d3.relatedTarget = f3, g3 = d3), f3 = g3, l4 && u3) b: {
              for (d3 = l4, p3 = u3, m3 = 0, h3 = d3; h3; h3 = _d2(h3)) m3++;
              for (h3 = 0, g3 = p3; g3; g3 = _d2(g3)) h3++;
              for (; 0 < m3 - h3; ) d3 = _d2(d3), m3--;
              for (; 0 < h3 - m3; ) p3 = _d2(p3), h3--;
              for (; m3--; ) {
                if (d3 === p3 || p3 !== null && d3 === p3.alternate) break b;
                d3 = _d2(d3), p3 = _d2(p3);
              }
              d3 = null;
            }
            else d3 = null;
            l4 !== null && vd2(s4, c4, l4, d3, false), u3 !== null && f3 !== null && vd2(s4, f3, u3, d3, true);
          }
        }
        a: {
          if (c4 = r4 ? A2(r4) : window, l4 = c4.nodeName && c4.nodeName.toLowerCase(), l4 === `select` || l4 === `input` && c4.type === `file`) var _3 = dr2;
          else if (ar2(c4)) if (fr2) _3 = xr2;
          else {
            _3 = yr2;
            var v3 = vr2;
          }
          else l4 = c4.nodeName, !l4 || l4.toLowerCase() !== `input` || c4.type !== `checkbox` && c4.type !== `radio` ? r4 && $t2(r4.elementType) && (_3 = dr2) : _3 = br2;
          if (_3 &&= _3(e3, r4)) {
            or2(s4, _3, n3, i4);
            break a;
          }
          v3 && v3(e3, c4, r4), e3 === `focusout` && r4 && c4.type === `number` && r4.memoizedProps.value != null && Kt2(c4, `number`, c4.value);
        }
        switch (v3 = r4 ? A2(r4) : window, e3) {
          case `focusin`:
            (ar2(v3) || v3.contentEditable === `true`) && (jr2 = v3, Mr2 = r4, Nr2 = null);
            break;
          case `focusout`:
            Nr2 = Mr2 = jr2 = null;
            break;
          case `mousedown`:
            Pr2 = true;
            break;
          case `contextmenu`:
          case `mouseup`:
          case `dragend`:
            Pr2 = false, Fr2(s4, n3, i4);
            break;
          case `selectionchange`:
            if (Ar2) break;
          case `keydown`:
          case `keyup`:
            Fr2(s4, n3, i4);
        }
        var y3;
        if (qn2) b: {
          switch (e3) {
            case `compositionstart`:
              var b3 = `onCompositionStart`;
              break b;
            case `compositionend`:
              b3 = `onCompositionEnd`;
              break b;
            case `compositionupdate`:
              b3 = `onCompositionUpdate`;
              break b;
          }
          b3 = void 0;
        }
        else tr2 ? $n2(e3, n3) && (b3 = `onCompositionEnd`) : e3 === `keydown` && n3.keyCode === 229 && (b3 = `onCompositionStart`);
        b3 && (Xn2 && n3.locale !== `ko` && (tr2 || b3 !== `onCompositionStart` ? b3 === `onCompositionEnd` && tr2 && (y3 = _n2()) : (hn2 = i4, P2 = `value` in hn2 ? hn2.value : hn2.textContent, tr2 = true)), v3 = gd2(r4, b3), 0 < v3.length && (b3 = new F2(b3, e3, null, n3, i4), s4.push({ event: b3, listeners: v3 }), y3 ? b3.data = y3 : (y3 = er2(n3), y3 !== null && (b3.data = y3)))), (y3 = Yn2 ? nr2(e3, n3) : rr2(e3, n3)) && (b3 = gd2(r4, `onBeforeInput`), 0 < b3.length && (v3 = new F2(`onBeforeInput`, `beforeinput`, null, n3, i4), s4.push({ event: v3, listeners: b3 }), v3.data = y3)), ad2(s4, e3, r4, n3, i4);
      }
      J2(s4, t3);
    });
  }
  function hd2(e3, t3, n3) {
    return { instance: e3, listener: t3, currentTarget: n3 };
  }
  function gd2(e3, t3) {
    for (var n3 = t3 + `Capture`, r3 = []; e3 !== null; ) {
      var i3 = e3, a3 = i3.stateNode;
      if (i3 = i3.tag, i3 !== 5 && i3 !== 26 && i3 !== 27 || a3 === null || (i3 = dn2(e3, n3), i3 != null && r3.unshift(hd2(e3, i3, a3)), i3 = dn2(e3, t3), i3 != null && r3.push(hd2(e3, i3, a3))), e3.tag === 3) return r3;
      e3 = e3.return;
    }
    return [];
  }
  function _d2(e3) {
    if (e3 === null) return null;
    do
      e3 = e3.return;
    while (e3 && e3.tag !== 5 && e3.tag !== 27);
    return e3 || null;
  }
  function vd2(e3, t3, n3, r3, i3) {
    for (var a3 = t3._reactName, o3 = []; n3 !== null && n3 !== r3; ) {
      var s3 = n3, c3 = s3.alternate, l3 = s3.stateNode;
      if (s3 = s3.tag, c3 !== null && c3 === r3) break;
      s3 !== 5 && s3 !== 26 && s3 !== 27 || l3 === null || (c3 = l3, i3 ? (l3 = dn2(n3, a3), l3 != null && o3.unshift(hd2(n3, l3, c3))) : i3 || (l3 = dn2(n3, a3), l3 != null && o3.push(hd2(n3, l3, c3)))), n3 = n3.return;
    }
    o3.length !== 0 && e3.push({ event: t3, listeners: o3 });
  }
  var yd2 = /\r\n?/g, bd2 = /\u0000|\uFFFD/g;
  function xd2(e3) {
    return (typeof e3 == `string` ? e3 : `` + e3).replace(yd2, `
`).replace(bd2, ``);
  }
  function Sd2(e3, t3) {
    return t3 = xd2(t3), xd2(e3) === t3;
  }
  function Cd2() {
  }
  function X2(e3, t3, n3, r3, a3, o3) {
    switch (n3) {
      case `children`:
        typeof r3 == `string` ? t3 === `body` || t3 === `textarea` && r3 === `` || N2(e3, r3) : (typeof r3 == `number` || typeof r3 == `bigint`) && t3 !== `body` && N2(e3, `` + r3);
        break;
      case `className`:
        Ot2(e3, `class`, r3);
        break;
      case `tabIndex`:
        Ot2(e3, `tabindex`, r3);
        break;
      case `dir`:
      case `role`:
      case `viewBox`:
      case `width`:
      case `height`:
        Ot2(e3, n3, r3);
        break;
      case `style`:
        Qt2(e3, r3, o3);
        break;
      case `data`:
        if (t3 !== `object`) {
          Ot2(e3, `data`, r3);
          break;
        }
      case `src`:
      case `href`:
        if (r3 === `` && (t3 !== `a` || n3 !== `href`)) {
          e3.removeAttribute(n3);
          break;
        }
        if (r3 == null || typeof r3 == `function` || typeof r3 == `symbol` || typeof r3 == `boolean`) {
          e3.removeAttribute(n3);
          break;
        }
        r3 = nn2(`` + r3), e3.setAttribute(n3, r3);
        break;
      case `action`:
      case `formAction`:
        if (typeof r3 == `function`) {
          e3.setAttribute(n3, `javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')`);
          break;
        } else typeof o3 == `function` && (n3 === `formAction` ? (t3 !== `input` && X2(e3, t3, `name`, a3.name, a3, null), X2(e3, t3, `formEncType`, a3.formEncType, a3, null), X2(e3, t3, `formMethod`, a3.formMethod, a3, null), X2(e3, t3, `formTarget`, a3.formTarget, a3, null)) : (X2(e3, t3, `encType`, a3.encType, a3, null), X2(e3, t3, `method`, a3.method, a3, null), X2(e3, t3, `target`, a3.target, a3, null)));
        if (r3 == null || typeof r3 == `symbol` || typeof r3 == `boolean`) {
          e3.removeAttribute(n3);
          break;
        }
        r3 = nn2(`` + r3), e3.setAttribute(n3, r3);
        break;
      case `onClick`:
        r3 != null && (e3.onclick = Cd2);
        break;
      case `onScroll`:
        r3 != null && Y2(`scroll`, e3);
        break;
      case `onScrollEnd`:
        r3 != null && Y2(`scrollend`, e3);
        break;
      case `dangerouslySetInnerHTML`:
        if (r3 != null) {
          if (typeof r3 != `object` || !(`__html` in r3)) throw Error(i2(61));
          if (n3 = r3.__html, n3 != null) {
            if (a3.children != null) throw Error(i2(60));
            e3.innerHTML = n3;
          }
        }
        break;
      case `multiple`:
        e3.multiple = r3 && typeof r3 != `function` && typeof r3 != `symbol`;
        break;
      case `muted`:
        e3.muted = r3 && typeof r3 != `function` && typeof r3 != `symbol`;
        break;
      case `suppressContentEditableWarning`:
      case `suppressHydrationWarning`:
      case `defaultValue`:
      case `defaultChecked`:
      case `innerHTML`:
      case `ref`:
        break;
      case `autoFocus`:
        break;
      case `xlinkHref`:
        if (r3 == null || typeof r3 == `function` || typeof r3 == `boolean` || typeof r3 == `symbol`) {
          e3.removeAttribute(`xlink:href`);
          break;
        }
        n3 = nn2(`` + r3), e3.setAttributeNS(`http://www.w3.org/1999/xlink`, `xlink:href`, n3);
        break;
      case `contentEditable`:
      case `spellCheck`:
      case `draggable`:
      case `value`:
      case `autoReverse`:
      case `externalResourcesRequired`:
      case `focusable`:
      case `preserveAlpha`:
        r3 != null && typeof r3 != `function` && typeof r3 != `symbol` ? e3.setAttribute(n3, `` + r3) : e3.removeAttribute(n3);
        break;
      case `inert`:
      case `allowFullScreen`:
      case `async`:
      case `autoPlay`:
      case `controls`:
      case `default`:
      case `defer`:
      case `disabled`:
      case `disablePictureInPicture`:
      case `disableRemotePlayback`:
      case `formNoValidate`:
      case `hidden`:
      case `loop`:
      case `noModule`:
      case `noValidate`:
      case `open`:
      case `playsInline`:
      case `readOnly`:
      case `required`:
      case `reversed`:
      case `scoped`:
      case `seamless`:
      case `itemScope`:
        r3 && typeof r3 != `function` && typeof r3 != `symbol` ? e3.setAttribute(n3, ``) : e3.removeAttribute(n3);
        break;
      case `capture`:
      case `download`:
        true === r3 ? e3.setAttribute(n3, ``) : false !== r3 && r3 != null && typeof r3 != `function` && typeof r3 != `symbol` ? e3.setAttribute(n3, r3) : e3.removeAttribute(n3);
        break;
      case `cols`:
      case `rows`:
      case `size`:
      case `span`:
        r3 != null && typeof r3 != `function` && typeof r3 != `symbol` && !isNaN(r3) && 1 <= r3 ? e3.setAttribute(n3, r3) : e3.removeAttribute(n3);
        break;
      case `rowSpan`:
      case `start`:
        r3 == null || typeof r3 == `function` || typeof r3 == `symbol` || isNaN(r3) ? e3.removeAttribute(n3) : e3.setAttribute(n3, r3);
        break;
      case `popover`:
        Y2(`beforetoggle`, e3), Y2(`toggle`, e3), Dt2(e3, `popover`, r3);
        break;
      case `xlinkActuate`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:actuate`, r3);
        break;
      case `xlinkArcrole`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:arcrole`, r3);
        break;
      case `xlinkRole`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:role`, r3);
        break;
      case `xlinkShow`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:show`, r3);
        break;
      case `xlinkTitle`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:title`, r3);
        break;
      case `xlinkType`:
        kt2(e3, `http://www.w3.org/1999/xlink`, `xlink:type`, r3);
        break;
      case `xmlBase`:
        kt2(e3, `http://www.w3.org/XML/1998/namespace`, `xml:base`, r3);
        break;
      case `xmlLang`:
        kt2(e3, `http://www.w3.org/XML/1998/namespace`, `xml:lang`, r3);
        break;
      case `xmlSpace`:
        kt2(e3, `http://www.w3.org/XML/1998/namespace`, `xml:space`, r3);
        break;
      case `is`:
        Dt2(e3, `is`, r3);
        break;
      case `innerText`:
      case `textContent`:
        break;
      default:
        (!(2 < n3.length) || n3[0] !== `o` && n3[0] !== `O` || n3[1] !== `n` && n3[1] !== `N`) && (n3 = en2.get(n3) || n3, Dt2(e3, n3, r3));
    }
  }
  function wd2(e3, t3, n3, r3, a3, o3) {
    switch (n3) {
      case `style`:
        Qt2(e3, r3, o3);
        break;
      case `dangerouslySetInnerHTML`:
        if (r3 != null) {
          if (typeof r3 != `object` || !(`__html` in r3)) throw Error(i2(61));
          if (n3 = r3.__html, n3 != null) {
            if (a3.children != null) throw Error(i2(60));
            e3.innerHTML = n3;
          }
        }
        break;
      case `children`:
        typeof r3 == `string` ? N2(e3, r3) : (typeof r3 == `number` || typeof r3 == `bigint`) && N2(e3, `` + r3);
        break;
      case `onScroll`:
        r3 != null && Y2(`scroll`, e3);
        break;
      case `onScrollEnd`:
        r3 != null && Y2(`scrollend`, e3);
        break;
      case `onClick`:
        r3 != null && (e3.onclick = Cd2);
        break;
      case `suppressContentEditableWarning`:
      case `suppressHydrationWarning`:
      case `innerHTML`:
      case `ref`:
        break;
      case `innerText`:
      case `textContent`:
        break;
      default:
        if (!bt2.hasOwnProperty(n3)) a: {
          if (n3[0] === `o` && n3[1] === `n` && (a3 = n3.endsWith(`Capture`), t3 = n3.slice(2, a3 ? n3.length - 7 : void 0), o3 = e3[ct2] || null, o3 = o3 == null ? null : o3[n3], typeof o3 == `function` && e3.removeEventListener(t3, o3, a3), typeof r3 == `function`)) {
            typeof o3 != `function` && o3 !== null && (n3 in e3 ? e3[n3] = null : e3.hasAttribute(n3) && e3.removeAttribute(n3)), e3.addEventListener(t3, r3, a3);
            break a;
          }
          n3 in e3 ? e3[n3] = r3 : true === r3 ? e3.setAttribute(n3, ``) : Dt2(e3, n3, r3);
        }
    }
  }
  function Td2(e3, t3, n3) {
    switch (t3) {
      case `div`:
      case `span`:
      case `svg`:
      case `path`:
      case `a`:
      case `g`:
      case `p`:
      case `li`:
        break;
      case `img`:
        Y2(`error`, e3), Y2(`load`, e3);
        var r3 = false, a3 = false, o3;
        for (o3 in n3) if (n3.hasOwnProperty(o3)) {
          var s3 = n3[o3];
          if (s3 != null) switch (o3) {
            case `src`:
              r3 = true;
              break;
            case `srcSet`:
              a3 = true;
              break;
            case `children`:
            case `dangerouslySetInnerHTML`:
              throw Error(i2(137, t3));
            default:
              X2(e3, t3, o3, s3, n3, null);
          }
        }
        a3 && X2(e3, t3, `srcSet`, n3.srcSet, n3, null), r3 && X2(e3, t3, `src`, n3.src, n3, null);
        return;
      case `input`:
        Y2(`invalid`, e3);
        var c3 = o3 = s3 = a3 = null, l3 = null, u3 = null;
        for (r3 in n3) if (n3.hasOwnProperty(r3)) {
          var d3 = n3[r3];
          if (d3 != null) switch (r3) {
            case `name`:
              a3 = d3;
              break;
            case `type`:
              s3 = d3;
              break;
            case `checked`:
              l3 = d3;
              break;
            case `defaultChecked`:
              u3 = d3;
              break;
            case `value`:
              o3 = d3;
              break;
            case `defaultValue`:
              c3 = d3;
              break;
            case `children`:
            case `dangerouslySetInnerHTML`:
              if (d3 != null) throw Error(i2(137, t3));
              break;
            default:
              X2(e3, t3, r3, d3, n3, null);
          }
        }
        M2(e3, o3, c3, l3, u3, s3, a3, false), Bt2(e3);
        return;
      case `select`:
        for (a3 in Y2(`invalid`, e3), r3 = s3 = o3 = null, n3) if (n3.hasOwnProperty(a3) && (c3 = n3[a3], c3 != null)) switch (a3) {
          case `value`:
            o3 = c3;
            break;
          case `defaultValue`:
            s3 = c3;
            break;
          case `multiple`:
            r3 = c3;
          default:
            X2(e3, t3, a3, c3, n3, null);
        }
        t3 = o3, n3 = s3, e3.multiple = !!r3, t3 == null ? n3 != null && qt2(e3, !!r3, n3, true) : qt2(e3, !!r3, t3, false);
        return;
      case `textarea`:
        for (s3 in Y2(`invalid`, e3), o3 = a3 = r3 = null, n3) if (n3.hasOwnProperty(s3) && (c3 = n3[s3], c3 != null)) switch (s3) {
          case `value`:
            r3 = c3;
            break;
          case `defaultValue`:
            a3 = c3;
            break;
          case `children`:
            o3 = c3;
            break;
          case `dangerouslySetInnerHTML`:
            if (c3 != null) throw Error(i2(91));
            break;
          default:
            X2(e3, t3, s3, c3, n3, null);
        }
        Yt2(e3, r3, a3, o3), Bt2(e3);
        return;
      case `option`:
        for (l3 in n3) if (n3.hasOwnProperty(l3) && (r3 = n3[l3], r3 != null)) switch (l3) {
          case `selected`:
            e3.selected = r3 && typeof r3 != `function` && typeof r3 != `symbol`;
            break;
          default:
            X2(e3, t3, l3, r3, n3, null);
        }
        return;
      case `dialog`:
        Y2(`beforetoggle`, e3), Y2(`toggle`, e3), Y2(`cancel`, e3), Y2(`close`, e3);
        break;
      case `iframe`:
      case `object`:
        Y2(`load`, e3);
        break;
      case `video`:
      case `audio`:
        for (r3 = 0; r3 < cd2.length; r3++) Y2(cd2[r3], e3);
        break;
      case `image`:
        Y2(`error`, e3), Y2(`load`, e3);
        break;
      case `details`:
        Y2(`toggle`, e3);
        break;
      case `embed`:
      case `source`:
      case `link`:
        Y2(`error`, e3), Y2(`load`, e3);
      case `area`:
      case `base`:
      case `br`:
      case `col`:
      case `hr`:
      case `keygen`:
      case `meta`:
      case `param`:
      case `track`:
      case `wbr`:
      case `menuitem`:
        for (u3 in n3) if (n3.hasOwnProperty(u3) && (r3 = n3[u3], r3 != null)) switch (u3) {
          case `children`:
          case `dangerouslySetInnerHTML`:
            throw Error(i2(137, t3));
          default:
            X2(e3, t3, u3, r3, n3, null);
        }
        return;
      default:
        if ($t2(t3)) {
          for (d3 in n3) n3.hasOwnProperty(d3) && (r3 = n3[d3], r3 !== void 0 && wd2(e3, t3, d3, r3, n3, void 0));
          return;
        }
    }
    for (c3 in n3) n3.hasOwnProperty(c3) && (r3 = n3[c3], r3 != null && X2(e3, t3, c3, r3, n3, null));
  }
  function Ed2(e3, t3, n3, r3) {
    switch (t3) {
      case `div`:
      case `span`:
      case `svg`:
      case `path`:
      case `a`:
      case `g`:
      case `p`:
      case `li`:
        break;
      case `input`:
        var a3 = null, o3 = null, s3 = null, c3 = null, l3 = null, u3 = null, d3 = null;
        for (m3 in n3) {
          var f3 = n3[m3];
          if (n3.hasOwnProperty(m3) && f3 != null) switch (m3) {
            case `checked`:
              break;
            case `value`:
              break;
            case `defaultValue`:
              l3 = f3;
            default:
              r3.hasOwnProperty(m3) || X2(e3, t3, m3, null, r3, f3);
          }
        }
        for (var p3 in r3) {
          var m3 = r3[p3];
          if (f3 = n3[p3], r3.hasOwnProperty(p3) && (m3 != null || f3 != null)) switch (p3) {
            case `type`:
              o3 = m3;
              break;
            case `name`:
              a3 = m3;
              break;
            case `checked`:
              u3 = m3;
              break;
            case `defaultChecked`:
              d3 = m3;
              break;
            case `value`:
              s3 = m3;
              break;
            case `defaultValue`:
              c3 = m3;
              break;
            case `children`:
            case `dangerouslySetInnerHTML`:
              if (m3 != null) throw Error(i2(137, t3));
              break;
            default:
              m3 !== f3 && X2(e3, t3, p3, m3, r3, f3);
          }
        }
        Gt2(e3, s3, c3, l3, u3, d3, o3, a3);
        return;
      case `select`:
        for (o3 in m3 = s3 = c3 = p3 = null, n3) if (l3 = n3[o3], n3.hasOwnProperty(o3) && l3 != null) switch (o3) {
          case `value`:
            break;
          case `multiple`:
            m3 = l3;
          default:
            r3.hasOwnProperty(o3) || X2(e3, t3, o3, null, r3, l3);
        }
        for (a3 in r3) if (o3 = r3[a3], l3 = n3[a3], r3.hasOwnProperty(a3) && (o3 != null || l3 != null)) switch (a3) {
          case `value`:
            p3 = o3;
            break;
          case `defaultValue`:
            c3 = o3;
            break;
          case `multiple`:
            s3 = o3;
          default:
            o3 !== l3 && X2(e3, t3, a3, o3, r3, l3);
        }
        t3 = c3, n3 = s3, r3 = m3, p3 == null ? !!r3 != !!n3 && (t3 == null ? qt2(e3, !!n3, n3 ? [] : ``, false) : qt2(e3, !!n3, t3, true)) : qt2(e3, !!n3, p3, false);
        return;
      case `textarea`:
        for (c3 in m3 = p3 = null, n3) if (a3 = n3[c3], n3.hasOwnProperty(c3) && a3 != null && !r3.hasOwnProperty(c3)) switch (c3) {
          case `value`:
            break;
          case `children`:
            break;
          default:
            X2(e3, t3, c3, null, r3, a3);
        }
        for (s3 in r3) if (a3 = r3[s3], o3 = n3[s3], r3.hasOwnProperty(s3) && (a3 != null || o3 != null)) switch (s3) {
          case `value`:
            p3 = a3;
            break;
          case `defaultValue`:
            m3 = a3;
            break;
          case `children`:
            break;
          case `dangerouslySetInnerHTML`:
            if (a3 != null) throw Error(i2(91));
            break;
          default:
            a3 !== o3 && X2(e3, t3, s3, a3, r3, o3);
        }
        Jt2(e3, p3, m3);
        return;
      case `option`:
        for (var h3 in n3) if (p3 = n3[h3], n3.hasOwnProperty(h3) && p3 != null && !r3.hasOwnProperty(h3)) switch (h3) {
          case `selected`:
            e3.selected = false;
            break;
          default:
            X2(e3, t3, h3, null, r3, p3);
        }
        for (l3 in r3) if (p3 = r3[l3], m3 = n3[l3], r3.hasOwnProperty(l3) && p3 !== m3 && (p3 != null || m3 != null)) switch (l3) {
          case `selected`:
            e3.selected = p3 && typeof p3 != `function` && typeof p3 != `symbol`;
            break;
          default:
            X2(e3, t3, l3, p3, r3, m3);
        }
        return;
      case `img`:
      case `link`:
      case `area`:
      case `base`:
      case `br`:
      case `col`:
      case `embed`:
      case `hr`:
      case `keygen`:
      case `meta`:
      case `param`:
      case `source`:
      case `track`:
      case `wbr`:
      case `menuitem`:
        for (var g3 in n3) p3 = n3[g3], n3.hasOwnProperty(g3) && p3 != null && !r3.hasOwnProperty(g3) && X2(e3, t3, g3, null, r3, p3);
        for (u3 in r3) if (p3 = r3[u3], m3 = n3[u3], r3.hasOwnProperty(u3) && p3 !== m3 && (p3 != null || m3 != null)) switch (u3) {
          case `children`:
          case `dangerouslySetInnerHTML`:
            if (p3 != null) throw Error(i2(137, t3));
            break;
          default:
            X2(e3, t3, u3, p3, r3, m3);
        }
        return;
      default:
        if ($t2(t3)) {
          for (var _3 in n3) p3 = n3[_3], n3.hasOwnProperty(_3) && p3 !== void 0 && !r3.hasOwnProperty(_3) && wd2(e3, t3, _3, void 0, r3, p3);
          for (d3 in r3) p3 = r3[d3], m3 = n3[d3], !r3.hasOwnProperty(d3) || p3 === m3 || p3 === void 0 && m3 === void 0 || wd2(e3, t3, d3, p3, r3, m3);
          return;
        }
    }
    for (var v3 in n3) p3 = n3[v3], n3.hasOwnProperty(v3) && p3 != null && !r3.hasOwnProperty(v3) && X2(e3, t3, v3, null, r3, p3);
    for (f3 in r3) p3 = r3[f3], m3 = n3[f3], !r3.hasOwnProperty(f3) || p3 === m3 || p3 == null && m3 == null || X2(e3, t3, f3, p3, r3, m3);
  }
  var Dd2 = null, Od2 = null;
  function kd2(e3) {
    return e3.nodeType === 9 ? e3 : e3.ownerDocument;
  }
  function Ad2(e3) {
    switch (e3) {
      case `http://www.w3.org/2000/svg`:
        return 1;
      case `http://www.w3.org/1998/Math/MathML`:
        return 2;
      default:
        return 0;
    }
  }
  function jd2(e3, t3) {
    if (e3 === 0) switch (t3) {
      case `svg`:
        return 1;
      case `math`:
        return 2;
      default:
        return 0;
    }
    return e3 === 1 && t3 === `foreignObject` ? 0 : e3;
  }
  function Md2(e3, t3) {
    return e3 === `textarea` || e3 === `noscript` || typeof t3.children == `string` || typeof t3.children == `number` || typeof t3.children == `bigint` || typeof t3.dangerouslySetInnerHTML == `object` && t3.dangerouslySetInnerHTML !== null && t3.dangerouslySetInnerHTML.__html != null;
  }
  var Nd2 = null;
  function Pd2() {
    var e3 = window.event;
    return e3 && e3.type === `popstate` ? e3 === Nd2 ? false : (Nd2 = e3, true) : (Nd2 = null, false);
  }
  var Fd2 = typeof setTimeout == `function` ? setTimeout : void 0, Id2 = typeof clearTimeout == `function` ? clearTimeout : void 0, Ld2 = typeof Promise == `function` ? Promise : void 0, Rd2 = typeof queueMicrotask == `function` ? queueMicrotask : Ld2 === void 0 ? Fd2 : function(e3) {
    return Ld2.resolve(null).then(e3).catch(zd2);
  };
  function zd2(e3) {
    setTimeout(function() {
      throw e3;
    });
  }
  function Bd2(e3) {
    return e3 === `head`;
  }
  function Vd2(e3, t3) {
    var n3 = t3, r3 = 0, i3 = 0;
    do {
      var a3 = n3.nextSibling;
      if (e3.removeChild(n3), a3 && a3.nodeType === 8) if (n3 = a3.data, n3 === `/$`) {
        if (0 < r3 && 8 > r3) {
          n3 = r3;
          var o3 = e3.ownerDocument;
          if (n3 & 1 && Zd2(o3.documentElement), n3 & 2 && Zd2(o3.body), n3 & 4) for (n3 = o3.head, Zd2(n3), o3 = n3.firstChild; o3; ) {
            var s3 = o3.nextSibling, c3 = o3.nodeName;
            o3[mt2] || c3 === `SCRIPT` || c3 === `STYLE` || c3 === `LINK` && o3.rel.toLowerCase() === `stylesheet` || n3.removeChild(o3), o3 = s3;
          }
        }
        if (i3 === 0) {
          e3.removeChild(a3), vp2(t3);
          return;
        }
        i3--;
      } else n3 === `$` || n3 === `$?` || n3 === `$!` ? i3++ : r3 = n3.charCodeAt(0) - 48;
      else r3 = 0;
      n3 = a3;
    } while (n3);
    vp2(t3);
  }
  function Hd2(e3) {
    var t3 = e3.firstChild;
    for (t3 && t3.nodeType === 10 && (t3 = t3.nextSibling); t3; ) {
      var n3 = t3;
      switch (t3 = t3.nextSibling, n3.nodeName) {
        case `HTML`:
        case `HEAD`:
        case `BODY`:
          Hd2(n3), ht2(n3);
          continue;
        case `SCRIPT`:
        case `STYLE`:
          continue;
        case `LINK`:
          if (n3.rel.toLowerCase() === `stylesheet`) continue;
      }
      e3.removeChild(n3);
    }
  }
  function Ud2(e3, t3, n3, r3) {
    for (; e3.nodeType === 1; ) {
      var i3 = n3;
      if (e3.nodeName.toLowerCase() !== t3.toLowerCase()) {
        if (!r3 && (e3.nodeName !== `INPUT` || e3.type !== `hidden`)) break;
      } else if (!r3) if (t3 === `input` && e3.type === `hidden`) {
        var a3 = i3.name == null ? null : `` + i3.name;
        if (i3.type === `hidden` && e3.getAttribute(`name`) === a3) return e3;
      } else return e3;
      else if (!e3[mt2]) switch (t3) {
        case `meta`:
          if (!e3.hasAttribute(`itemprop`)) break;
          return e3;
        case `link`:
          if (a3 = e3.getAttribute(`rel`), a3 === `stylesheet` && e3.hasAttribute(`data-precedence`) || a3 !== i3.rel || e3.getAttribute(`href`) !== (i3.href == null || i3.href === `` ? null : i3.href) || e3.getAttribute(`crossorigin`) !== (i3.crossOrigin == null ? null : i3.crossOrigin) || e3.getAttribute(`title`) !== (i3.title == null ? null : i3.title)) break;
          return e3;
        case `style`:
          if (e3.hasAttribute(`data-precedence`)) break;
          return e3;
        case `script`:
          if (a3 = e3.getAttribute(`src`), (a3 !== (i3.src == null ? null : i3.src) || e3.getAttribute(`type`) !== (i3.type == null ? null : i3.type) || e3.getAttribute(`crossorigin`) !== (i3.crossOrigin == null ? null : i3.crossOrigin)) && a3 && e3.hasAttribute(`async`) && !e3.hasAttribute(`itemprop`)) break;
          return e3;
        default:
          return e3;
      }
      if (e3 = qd2(e3.nextSibling), e3 === null) break;
    }
    return null;
  }
  function Wd2(e3, t3, n3) {
    if (t3 === ``) return null;
    for (; e3.nodeType !== 3; ) if ((e3.nodeType !== 1 || e3.nodeName !== `INPUT` || e3.type !== `hidden`) && !n3 || (e3 = qd2(e3.nextSibling), e3 === null)) return null;
    return e3;
  }
  function Gd2(e3) {
    return e3.data === `$!` || e3.data === `$?` && e3.ownerDocument.readyState === `complete`;
  }
  function Kd2(e3, t3) {
    var n3 = e3.ownerDocument;
    if (e3.data !== `$?` || n3.readyState === `complete`) t3();
    else {
      var r3 = function() {
        t3(), n3.removeEventListener(`DOMContentLoaded`, r3);
      };
      n3.addEventListener(`DOMContentLoaded`, r3), e3._reactRetry = r3;
    }
  }
  function qd2(e3) {
    for (; e3 != null; e3 = e3.nextSibling) {
      var t3 = e3.nodeType;
      if (t3 === 1 || t3 === 3) break;
      if (t3 === 8) {
        if (t3 = e3.data, t3 === `$` || t3 === `$!` || t3 === `$?` || t3 === `F!` || t3 === `F`) break;
        if (t3 === `/$`) return null;
      }
    }
    return e3;
  }
  var Jd2 = null;
  function Yd2(e3) {
    e3 = e3.previousSibling;
    for (var t3 = 0; e3; ) {
      if (e3.nodeType === 8) {
        var n3 = e3.data;
        if (n3 === `$` || n3 === `$!` || n3 === `$?`) {
          if (t3 === 0) return e3;
          t3--;
        } else n3 === `/$` && t3++;
      }
      e3 = e3.previousSibling;
    }
    return null;
  }
  function Xd2(e3, t3, n3) {
    switch (t3 = kd2(n3), e3) {
      case `html`:
        if (e3 = t3.documentElement, !e3) throw Error(i2(452));
        return e3;
      case `head`:
        if (e3 = t3.head, !e3) throw Error(i2(453));
        return e3;
      case `body`:
        if (e3 = t3.body, !e3) throw Error(i2(454));
        return e3;
      default:
        throw Error(i2(451));
    }
  }
  function Zd2(e3) {
    for (var t3 = e3.attributes; t3.length; ) e3.removeAttributeNode(t3[0]);
    ht2(e3);
  }
  var Qd2 = /* @__PURE__ */ new Map(), $d2 = /* @__PURE__ */ new Set();
  function ef2(e3) {
    return typeof e3.getRootNode == `function` ? e3.getRootNode() : e3.nodeType === 9 ? e3 : e3.ownerDocument;
  }
  var tf2 = T2.d;
  T2.d = { f: nf2, r: rf2, D: sf2, C: cf2, L: lf2, m: uf2, X: ff2, S: df2, M: pf2 };
  function nf2() {
    var e3 = tf2.f(), t3 = fu2();
    return e3 || t3;
  }
  function rf2(e3) {
    var t3 = _t2(e3);
    t3 !== null && t3.tag === 5 && t3.type === `form` ? ss2(t3) : tf2.r(e3);
  }
  var af2 = typeof document > `u` ? null : document;
  function of2(e3, t3, n3) {
    var r3 = af2;
    if (r3 && typeof t3 == `string` && t3) {
      var i3 = Wt2(t3);
      i3 = `link[rel="` + e3 + `"][href="` + i3 + `"]`, typeof n3 == `string` && (i3 += `[crossorigin="` + n3 + `"]`), $d2.has(i3) || ($d2.add(i3), e3 = { rel: e3, crossOrigin: n3, href: t3 }, r3.querySelector(i3) === null && (t3 = r3.createElement(`link`), Td2(t3, `link`, e3), j2(t3), r3.head.appendChild(t3)));
    }
  }
  function sf2(e3) {
    tf2.D(e3), of2(`dns-prefetch`, e3, null);
  }
  function cf2(e3, t3) {
    tf2.C(e3, t3), of2(`preconnect`, e3, t3);
  }
  function lf2(e3, t3, n3) {
    tf2.L(e3, t3, n3);
    var r3 = af2;
    if (r3 && e3 && t3) {
      var i3 = `link[rel="preload"][as="` + Wt2(t3) + `"]`;
      t3 === `image` && n3 && n3.imageSrcSet ? (i3 += `[imagesrcset="` + Wt2(n3.imageSrcSet) + `"]`, typeof n3.imageSizes == `string` && (i3 += `[imagesizes="` + Wt2(n3.imageSizes) + `"]`)) : i3 += `[href="` + Wt2(e3) + `"]`;
      var a3 = i3;
      switch (t3) {
        case `style`:
          a3 = hf2(e3);
          break;
        case `script`:
          a3 = yf2(e3);
      }
      Qd2.has(a3) || (e3 = d2({ rel: `preload`, href: t3 === `image` && n3 && n3.imageSrcSet ? void 0 : e3, as: t3 }, n3), Qd2.set(a3, e3), r3.querySelector(i3) !== null || t3 === `style` && r3.querySelector(gf2(a3)) || t3 === `script` && r3.querySelector(bf2(a3)) || (t3 = r3.createElement(`link`), Td2(t3, `link`, e3), j2(t3), r3.head.appendChild(t3)));
    }
  }
  function uf2(e3, t3) {
    tf2.m(e3, t3);
    var n3 = af2;
    if (n3 && e3) {
      var r3 = t3 && typeof t3.as == `string` ? t3.as : `script`, i3 = `link[rel="modulepreload"][as="` + Wt2(r3) + `"][href="` + Wt2(e3) + `"]`, a3 = i3;
      switch (r3) {
        case `audioworklet`:
        case `paintworklet`:
        case `serviceworker`:
        case `sharedworker`:
        case `worker`:
        case `script`:
          a3 = yf2(e3);
      }
      if (!Qd2.has(a3) && (e3 = d2({ rel: `modulepreload`, href: e3 }, t3), Qd2.set(a3, e3), n3.querySelector(i3) === null)) {
        switch (r3) {
          case `audioworklet`:
          case `paintworklet`:
          case `serviceworker`:
          case `sharedworker`:
          case `worker`:
          case `script`:
            if (n3.querySelector(bf2(a3))) return;
        }
        r3 = n3.createElement(`link`), Td2(r3, `link`, e3), j2(r3), n3.head.appendChild(r3);
      }
    }
  }
  function df2(e3, t3, n3) {
    tf2.S(e3, t3, n3);
    var r3 = af2;
    if (r3 && e3) {
      var i3 = vt2(r3).hoistableStyles, a3 = hf2(e3);
      t3 ||= `default`;
      var o3 = i3.get(a3);
      if (!o3) {
        var s3 = { loading: 0, preload: null };
        if (o3 = r3.querySelector(gf2(a3))) s3.loading = 5;
        else {
          e3 = d2({ rel: `stylesheet`, href: e3, "data-precedence": t3 }, n3), (n3 = Qd2.get(a3)) && Cf2(e3, n3);
          var c3 = o3 = r3.createElement(`link`);
          j2(c3), Td2(c3, `link`, e3), c3._p = new Promise(function(e4, t4) {
            c3.onload = e4, c3.onerror = t4;
          }), c3.addEventListener(`load`, function() {
            s3.loading |= 1;
          }), c3.addEventListener(`error`, function() {
            s3.loading |= 2;
          }), s3.loading |= 4, Sf2(o3, t3, r3);
        }
        o3 = { type: `stylesheet`, instance: o3, count: 1, state: s3 }, i3.set(a3, o3);
      }
    }
  }
  function ff2(e3, t3) {
    tf2.X(e3, t3);
    var n3 = af2;
    if (n3 && e3) {
      var r3 = vt2(n3).hoistableScripts, i3 = yf2(e3), a3 = r3.get(i3);
      a3 || (a3 = n3.querySelector(bf2(i3)), a3 || (e3 = d2({ src: e3, async: true }, t3), (t3 = Qd2.get(i3)) && wf2(e3, t3), a3 = n3.createElement(`script`), j2(a3), Td2(a3, `link`, e3), n3.head.appendChild(a3)), a3 = { type: `script`, instance: a3, count: 1, state: null }, r3.set(i3, a3));
    }
  }
  function pf2(e3, t3) {
    tf2.M(e3, t3);
    var n3 = af2;
    if (n3 && e3) {
      var r3 = vt2(n3).hoistableScripts, i3 = yf2(e3), a3 = r3.get(i3);
      a3 || (a3 = n3.querySelector(bf2(i3)), a3 || (e3 = d2({ src: e3, async: true, type: `module` }, t3), (t3 = Qd2.get(i3)) && wf2(e3, t3), a3 = n3.createElement(`script`), j2(a3), Td2(a3, `link`, e3), n3.head.appendChild(a3)), a3 = { type: `script`, instance: a3, count: 1, state: null }, r3.set(i3, a3));
    }
  }
  function mf2(e3, t3, n3, r3) {
    var a3 = (a3 = he2.current) ? ef2(a3) : null;
    if (!a3) throw Error(i2(446));
    switch (e3) {
      case `meta`:
      case `title`:
        return null;
      case `style`:
        return typeof n3.precedence == `string` && typeof n3.href == `string` ? (t3 = hf2(n3.href), n3 = vt2(a3).hoistableStyles, r3 = n3.get(t3), r3 || (r3 = { type: `style`, instance: null, count: 0, state: null }, n3.set(t3, r3)), r3) : { type: `void`, instance: null, count: 0, state: null };
      case `link`:
        if (n3.rel === `stylesheet` && typeof n3.href == `string` && typeof n3.precedence == `string`) {
          e3 = hf2(n3.href);
          var o3 = vt2(a3).hoistableStyles, s3 = o3.get(e3);
          if (s3 || (a3 = a3.ownerDocument || a3, s3 = { type: `stylesheet`, instance: null, count: 0, state: { loading: 0, preload: null } }, o3.set(e3, s3), (o3 = a3.querySelector(gf2(e3))) && !o3._p && (s3.instance = o3, s3.state.loading = 5), Qd2.has(e3) || (n3 = { rel: `preload`, as: `style`, href: n3.href, crossOrigin: n3.crossOrigin, integrity: n3.integrity, media: n3.media, hrefLang: n3.hrefLang, referrerPolicy: n3.referrerPolicy }, Qd2.set(e3, n3), o3 || vf2(a3, e3, n3, s3.state))), t3 && r3 === null) throw Error(i2(528, ``));
          return s3;
        }
        if (t3 && r3 !== null) throw Error(i2(529, ``));
        return null;
      case `script`:
        return t3 = n3.async, n3 = n3.src, typeof n3 == `string` && t3 && typeof t3 != `function` && typeof t3 != `symbol` ? (t3 = yf2(n3), n3 = vt2(a3).hoistableScripts, r3 = n3.get(t3), r3 || (r3 = { type: `script`, instance: null, count: 0, state: null }, n3.set(t3, r3)), r3) : { type: `void`, instance: null, count: 0, state: null };
      default:
        throw Error(i2(444, e3));
    }
  }
  function hf2(e3) {
    return `href="` + Wt2(e3) + `"`;
  }
  function gf2(e3) {
    return `link[rel="stylesheet"][` + e3 + `]`;
  }
  function _f2(e3) {
    return d2({}, e3, { "data-precedence": e3.precedence, precedence: null });
  }
  function vf2(e3, t3, n3, r3) {
    e3.querySelector(`link[rel="preload"][as="style"][` + t3 + `]`) ? r3.loading = 1 : (t3 = e3.createElement(`link`), r3.preload = t3, t3.addEventListener(`load`, function() {
      return r3.loading |= 1;
    }), t3.addEventListener(`error`, function() {
      return r3.loading |= 2;
    }), Td2(t3, `link`, n3), j2(t3), e3.head.appendChild(t3));
  }
  function yf2(e3) {
    return `[src="` + Wt2(e3) + `"]`;
  }
  function bf2(e3) {
    return `script[async]` + e3;
  }
  function xf2(e3, t3, n3) {
    if (t3.count++, t3.instance === null) switch (t3.type) {
      case `style`:
        var r3 = e3.querySelector(`style[data-href~="` + Wt2(n3.href) + `"]`);
        if (r3) return t3.instance = r3, j2(r3), r3;
        var a3 = d2({}, n3, { "data-href": n3.href, "data-precedence": n3.precedence, href: null, precedence: null });
        return r3 = (e3.ownerDocument || e3).createElement(`style`), j2(r3), Td2(r3, `style`, a3), Sf2(r3, n3.precedence, e3), t3.instance = r3;
      case `stylesheet`:
        a3 = hf2(n3.href);
        var o3 = e3.querySelector(gf2(a3));
        if (o3) return t3.state.loading |= 4, t3.instance = o3, j2(o3), o3;
        r3 = _f2(n3), (a3 = Qd2.get(a3)) && Cf2(r3, a3), o3 = (e3.ownerDocument || e3).createElement(`link`), j2(o3);
        var s3 = o3;
        return s3._p = new Promise(function(e4, t4) {
          s3.onload = e4, s3.onerror = t4;
        }), Td2(o3, `link`, r3), t3.state.loading |= 4, Sf2(o3, n3.precedence, e3), t3.instance = o3;
      case `script`:
        return o3 = yf2(n3.src), (a3 = e3.querySelector(bf2(o3))) ? (t3.instance = a3, j2(a3), a3) : (r3 = n3, (a3 = Qd2.get(o3)) && (r3 = d2({}, n3), wf2(r3, a3)), e3 = e3.ownerDocument || e3, a3 = e3.createElement(`script`), j2(a3), Td2(a3, `link`, r3), e3.head.appendChild(a3), t3.instance = a3);
      case `void`:
        return null;
      default:
        throw Error(i2(443, t3.type));
    }
    else t3.type === `stylesheet` && !(t3.state.loading & 4) && (r3 = t3.instance, t3.state.loading |= 4, Sf2(r3, n3.precedence, e3));
    return t3.instance;
  }
  function Sf2(e3, t3, n3) {
    for (var r3 = n3.querySelectorAll(`link[rel="stylesheet"][data-precedence],style[data-precedence]`), i3 = r3.length ? r3[r3.length - 1] : null, a3 = i3, o3 = 0; o3 < r3.length; o3++) {
      var s3 = r3[o3];
      if (s3.dataset.precedence === t3) a3 = s3;
      else if (a3 !== i3) break;
    }
    a3 ? a3.parentNode.insertBefore(e3, a3.nextSibling) : (t3 = n3.nodeType === 9 ? n3.head : n3, t3.insertBefore(e3, t3.firstChild));
  }
  function Cf2(e3, t3) {
    e3.crossOrigin ??= t3.crossOrigin, e3.referrerPolicy ??= t3.referrerPolicy, e3.title ??= t3.title;
  }
  function wf2(e3, t3) {
    e3.crossOrigin ??= t3.crossOrigin, e3.referrerPolicy ??= t3.referrerPolicy, e3.integrity ??= t3.integrity;
  }
  var Tf2 = null;
  function Ef2(e3, t3, n3) {
    if (Tf2 === null) {
      var r3 = /* @__PURE__ */ new Map(), i3 = Tf2 = /* @__PURE__ */ new Map();
      i3.set(n3, r3);
    } else i3 = Tf2, r3 = i3.get(n3), r3 || (r3 = /* @__PURE__ */ new Map(), i3.set(n3, r3));
    if (r3.has(e3)) return r3;
    for (r3.set(e3, null), n3 = n3.getElementsByTagName(e3), i3 = 0; i3 < n3.length; i3++) {
      var a3 = n3[i3];
      if (!(a3[mt2] || a3[st2] || e3 === `link` && a3.getAttribute(`rel`) === `stylesheet`) && a3.namespaceURI !== `http://www.w3.org/2000/svg`) {
        var o3 = a3.getAttribute(t3) || ``;
        o3 = e3 + o3;
        var s3 = r3.get(o3);
        s3 ? s3.push(a3) : r3.set(o3, [a3]);
      }
    }
    return r3;
  }
  function Df2(e3, t3, n3) {
    e3 = e3.ownerDocument || e3, e3.head.insertBefore(n3, t3 === `title` ? e3.querySelector(`head > title`) : null);
  }
  function Of2(e3, t3, n3) {
    if (n3 === 1 || t3.itemProp != null) return false;
    switch (e3) {
      case `meta`:
      case `title`:
        return true;
      case `style`:
        if (typeof t3.precedence != `string` || typeof t3.href != `string` || t3.href === ``) break;
        return true;
      case `link`:
        if (typeof t3.rel != `string` || typeof t3.href != `string` || t3.href === `` || t3.onLoad || t3.onError) break;
        switch (t3.rel) {
          case `stylesheet`:
            return e3 = t3.disabled, typeof t3.precedence == `string` && e3 == null;
          default:
            return true;
        }
      case `script`:
        if (t3.async && typeof t3.async != `function` && typeof t3.async != `symbol` && !t3.onLoad && !t3.onError && t3.src && typeof t3.src == `string`) return true;
    }
    return false;
  }
  function kf2(e3) {
    return !(e3.type === `stylesheet` && !(e3.state.loading & 3));
  }
  var Af2 = null;
  function jf2() {
  }
  function Mf2(e3, t3, n3) {
    if (Af2 === null) throw Error(i2(475));
    var r3 = Af2;
    if (t3.type === `stylesheet` && (typeof n3.media != `string` || false !== matchMedia(n3.media).matches) && !(t3.state.loading & 4)) {
      if (t3.instance === null) {
        var a3 = hf2(n3.href), o3 = e3.querySelector(gf2(a3));
        if (o3) {
          e3 = o3._p, typeof e3 == `object` && e3 && typeof e3.then == `function` && (r3.count++, r3 = Pf2.bind(r3), e3.then(r3, r3)), t3.state.loading |= 4, t3.instance = o3, j2(o3);
          return;
        }
        o3 = e3.ownerDocument || e3, n3 = _f2(n3), (a3 = Qd2.get(a3)) && Cf2(n3, a3), o3 = o3.createElement(`link`), j2(o3);
        var s3 = o3;
        s3._p = new Promise(function(e4, t4) {
          s3.onload = e4, s3.onerror = t4;
        }), Td2(o3, `link`, n3), t3.instance = o3;
      }
      r3.stylesheets === null && (r3.stylesheets = /* @__PURE__ */ new Map()), r3.stylesheets.set(t3, e3), (e3 = t3.state.preload) && !(t3.state.loading & 3) && (r3.count++, t3 = Pf2.bind(r3), e3.addEventListener(`load`, t3), e3.addEventListener(`error`, t3));
    }
  }
  function Nf2() {
    if (Af2 === null) throw Error(i2(475));
    var e3 = Af2;
    return e3.stylesheets && e3.count === 0 && If2(e3, e3.stylesheets), 0 < e3.count ? function(t3) {
      var n3 = setTimeout(function() {
        if (e3.stylesheets && If2(e3, e3.stylesheets), e3.unsuspend) {
          var t4 = e3.unsuspend;
          e3.unsuspend = null, t4();
        }
      }, 6e4);
      return e3.unsuspend = t3, function() {
        e3.unsuspend = null, clearTimeout(n3);
      };
    } : null;
  }
  function Pf2() {
    if (this.count--, this.count === 0) {
      if (this.stylesheets) If2(this, this.stylesheets);
      else if (this.unsuspend) {
        var e3 = this.unsuspend;
        this.unsuspend = null, e3();
      }
    }
  }
  var Ff2 = null;
  function If2(e3, t3) {
    e3.stylesheets = null, e3.unsuspend !== null && (e3.count++, Ff2 = /* @__PURE__ */ new Map(), t3.forEach(Lf2, e3), Ff2 = null, Pf2.call(e3));
  }
  function Lf2(e3, t3) {
    if (!(t3.state.loading & 4)) {
      var n3 = Ff2.get(e3);
      if (n3) var r3 = n3.get(null);
      else {
        n3 = /* @__PURE__ */ new Map(), Ff2.set(e3, n3);
        for (var i3 = e3.querySelectorAll(`link[data-precedence],style[data-precedence]`), a3 = 0; a3 < i3.length; a3++) {
          var o3 = i3[a3];
          (o3.nodeName === `LINK` || o3.getAttribute(`media`) !== `not all`) && (n3.set(o3.dataset.precedence, o3), r3 = o3);
        }
        r3 && n3.set(null, r3);
      }
      i3 = t3.instance, o3 = i3.getAttribute(`data-precedence`), a3 = n3.get(o3) || r3, a3 === r3 && n3.set(null, i3), n3.set(o3, i3), this.count++, r3 = Pf2.bind(this), i3.addEventListener(`load`, r3), i3.addEventListener(`error`, r3), a3 ? a3.parentNode.insertBefore(i3, a3.nextSibling) : (e3 = e3.nodeType === 9 ? e3.head : e3, e3.insertBefore(i3, e3.firstChild)), t3.state.loading |= 4;
    }
  }
  var Rf2 = { $$typeof: b2, Provider: null, Consumer: null, _currentValue: le2, _currentValue2: le2, _threadCount: 0 };
  function zf2(e3, t3, n3, r3, i3, a3, o3, s3) {
    this.tag = 1, this.containerInfo = e3, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = Ze2(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Ze2(0), this.hiddenUpdates = Ze2(null), this.identifierPrefix = r3, this.onUncaughtError = i3, this.onCaughtError = a3, this.onRecoverableError = o3, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = s3, this.incompleteTransitions = /* @__PURE__ */ new Map();
  }
  function Bf2(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3) {
    return e3 = new zf2(e3, t3, n3, o3, s3, c3, l3, d3), t3 = 1, true === a3 && (t3 |= 24), a3 = ui2(3, null, null, t3), e3.current = a3, a3.stateNode = e3, t3 = oa2(), t3.refCount++, e3.pooledCache = t3, t3.refCount++, a3.memoizedState = { element: r3, isDehydrated: n3, cache: t3 }, ja2(a3), e3;
  }
  function Vf2(e3) {
    return e3 ? (e3 = ci2, e3) : ci2;
  }
  function Hf2(e3, t3, n3, r3, i3, a3) {
    i3 = Vf2(i3), r3.context === null ? r3.context = i3 : r3.pendingContext = i3, r3 = Na2(t3), r3.payload = { element: n3 }, a3 = a3 === void 0 ? null : a3, a3 !== null && (r3.callback = a3), n3 = Pa2(e3, r3, t3), n3 !== null && (su2(n3, e3, t3), Fa2(n3, e3, t3));
  }
  function Uf2(e3, t3) {
    if (e3 = e3.memoizedState, e3 !== null && e3.dehydrated !== null) {
      var n3 = e3.retryLane;
      e3.retryLane = n3 !== 0 && n3 < t3 ? n3 : t3;
    }
  }
  function Wf2(e3, t3) {
    Uf2(e3, t3), (e3 = e3.alternate) && Uf2(e3, t3);
  }
  function Gf2(e3) {
    if (e3.tag === 13) {
      var t3 = ai2(e3, 67108864);
      t3 !== null && su2(t3, e3, 67108864), Wf2(e3, 67108864);
    }
  }
  var Kf2 = true;
  function qf2(e3, t3, n3, r3) {
    var i3 = w2.T;
    w2.T = null;
    var a3 = T2.p;
    try {
      T2.p = 2, Yf2(e3, t3, n3, r3);
    } finally {
      T2.p = a3, w2.T = i3;
    }
  }
  function Jf2(e3, t3, n3, r3) {
    var i3 = w2.T;
    w2.T = null;
    var a3 = T2.p;
    try {
      T2.p = 8, Yf2(e3, t3, n3, r3);
    } finally {
      T2.p = a3, w2.T = i3;
    }
  }
  function Yf2(e3, t3, n3, r3) {
    if (Kf2) {
      var i3 = Xf2(r3);
      if (i3 === null) md2(e3, t3, r3, Zf2, n3), cp2(e3, r3);
      else if (up2(i3, e3, t3, n3, r3)) r3.stopPropagation();
      else if (cp2(e3, r3), t3 & 4 && -1 < sp2.indexOf(e3)) {
        for (; i3 !== null; ) {
          var a3 = _t2(i3);
          if (a3 !== null) switch (a3.tag) {
            case 3:
              if (a3 = a3.stateNode, a3.current.memoizedState.isDehydrated) {
                var o3 = Ge2(a3.pendingLanes);
                if (o3 !== 0) {
                  var s3 = a3;
                  for (s3.pendingLanes |= 2, s3.entangledLanes |= 2; o3; ) {
                    var c3 = 1 << 31 - k2(o3);
                    s3.entanglements[1] |= c3, o3 &= ~c3;
                  }
                  Ju2(a3), !(H2 & 6) && (ql2 = Oe2() + 500, Yu2(0, false));
                }
              }
              break;
            case 13:
              s3 = ai2(a3, 2), s3 !== null && su2(s3, a3, 2), fu2(), Wf2(a3, 2);
          }
          if (a3 = Xf2(r3), a3 === null && md2(e3, t3, r3, Zf2, n3), a3 === i3) break;
          i3 = a3;
        }
        i3 !== null && r3.stopPropagation();
      } else md2(e3, t3, r3, null, n3);
    }
  }
  function Xf2(e3) {
    return e3 = an2(e3), Qf2(e3);
  }
  var Zf2 = null;
  function Qf2(e3) {
    if (Zf2 = null, e3 = gt2(e3), e3 !== null) {
      var t3 = o2(e3);
      if (t3 === null) e3 = null;
      else {
        var n3 = t3.tag;
        if (n3 === 13) {
          if (e3 = s2(t3), e3 !== null) return e3;
          e3 = null;
        } else if (n3 === 3) {
          if (t3.stateNode.current.memoizedState.isDehydrated) return t3.tag === 3 ? t3.stateNode.containerInfo : null;
          e3 = null;
        } else t3 !== e3 && (e3 = null);
      }
    }
    return Zf2 = e3, null;
  }
  function $f2(e3) {
    switch (e3) {
      case `beforetoggle`:
      case `cancel`:
      case `click`:
      case `close`:
      case `contextmenu`:
      case `copy`:
      case `cut`:
      case `auxclick`:
      case `dblclick`:
      case `dragend`:
      case `dragstart`:
      case `drop`:
      case `focusin`:
      case `focusout`:
      case `input`:
      case `invalid`:
      case `keydown`:
      case `keypress`:
      case `keyup`:
      case `mousedown`:
      case `mouseup`:
      case `paste`:
      case `pause`:
      case `play`:
      case `pointercancel`:
      case `pointerdown`:
      case `pointerup`:
      case `ratechange`:
      case `reset`:
      case `resize`:
      case `seeked`:
      case `submit`:
      case `toggle`:
      case `touchcancel`:
      case `touchend`:
      case `touchstart`:
      case `volumechange`:
      case `change`:
      case `selectionchange`:
      case `textInput`:
      case `compositionstart`:
      case `compositionend`:
      case `compositionupdate`:
      case `beforeblur`:
      case `afterblur`:
      case `beforeinput`:
      case `blur`:
      case `fullscreenchange`:
      case `focus`:
      case `hashchange`:
      case `popstate`:
      case `select`:
      case `selectstart`:
        return 2;
      case `drag`:
      case `dragenter`:
      case `dragexit`:
      case `dragleave`:
      case `dragover`:
      case `mousemove`:
      case `mouseout`:
      case `mouseover`:
      case `pointermove`:
      case `pointerout`:
      case `pointerover`:
      case `scroll`:
      case `touchmove`:
      case `wheel`:
      case `mouseenter`:
      case `mouseleave`:
      case `pointerenter`:
      case `pointerleave`:
        return 8;
      case `message`:
        switch (ke2()) {
          case Ae2:
            return 2;
          case je2:
            return 8;
          case Me2:
          case Ne2:
            return 32;
          case Pe2:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var ep2 = false, tp2 = null, np2 = null, rp2 = null, ip2 = /* @__PURE__ */ new Map(), ap2 = /* @__PURE__ */ new Map(), op2 = [], sp2 = `mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset`.split(` `);
  function cp2(e3, t3) {
    switch (e3) {
      case `focusin`:
      case `focusout`:
        tp2 = null;
        break;
      case `dragenter`:
      case `dragleave`:
        np2 = null;
        break;
      case `mouseover`:
      case `mouseout`:
        rp2 = null;
        break;
      case `pointerover`:
      case `pointerout`:
        ip2.delete(t3.pointerId);
        break;
      case `gotpointercapture`:
      case `lostpointercapture`:
        ap2.delete(t3.pointerId);
    }
  }
  function lp2(e3, t3, n3, r3, i3, a3) {
    return e3 === null || e3.nativeEvent !== a3 ? (e3 = { blockedOn: t3, domEventName: n3, eventSystemFlags: r3, nativeEvent: a3, targetContainers: [i3] }, t3 !== null && (t3 = _t2(t3), t3 !== null && Gf2(t3)), e3) : (e3.eventSystemFlags |= r3, t3 = e3.targetContainers, i3 !== null && t3.indexOf(i3) === -1 && t3.push(i3), e3);
  }
  function up2(e3, t3, n3, r3, i3) {
    switch (t3) {
      case `focusin`:
        return tp2 = lp2(tp2, e3, t3, n3, r3, i3), true;
      case `dragenter`:
        return np2 = lp2(np2, e3, t3, n3, r3, i3), true;
      case `mouseover`:
        return rp2 = lp2(rp2, e3, t3, n3, r3, i3), true;
      case `pointerover`:
        var a3 = i3.pointerId;
        return ip2.set(a3, lp2(ip2.get(a3) || null, e3, t3, n3, r3, i3)), true;
      case `gotpointercapture`:
        return a3 = i3.pointerId, ap2.set(a3, lp2(ap2.get(a3) || null, e3, t3, n3, r3, i3)), true;
    }
    return false;
  }
  function dp2(e3) {
    var t3 = gt2(e3.target);
    if (t3 !== null) {
      var n3 = o2(t3);
      if (n3 !== null) {
        if (t3 = n3.tag, t3 === 13) {
          if (t3 = s2(n3), t3 !== null) {
            e3.blockedOn = t3, at2(e3.priority, function() {
              if (n3.tag === 13) {
                var e4 = au2();
                e4 = nt2(e4);
                var t4 = ai2(n3, e4);
                t4 !== null && su2(t4, n3, e4), Wf2(n3, e4);
              }
            });
            return;
          }
        } else if (t3 === 3 && n3.stateNode.current.memoizedState.isDehydrated) {
          e3.blockedOn = n3.tag === 3 ? n3.stateNode.containerInfo : null;
          return;
        }
      }
    }
    e3.blockedOn = null;
  }
  function fp2(e3) {
    if (e3.blockedOn !== null) return false;
    for (var t3 = e3.targetContainers; 0 < t3.length; ) {
      var n3 = Xf2(e3.nativeEvent);
      if (n3 === null) {
        n3 = e3.nativeEvent;
        var r3 = new n3.constructor(n3.type, n3);
        rn2 = r3, n3.target.dispatchEvent(r3), rn2 = null;
      } else return t3 = _t2(n3), t3 !== null && Gf2(t3), e3.blockedOn = n3, false;
      t3.shift();
    }
    return true;
  }
  function pp2(e3, t3, n3) {
    fp2(e3) && n3.delete(t3);
  }
  function mp2() {
    ep2 = false, tp2 !== null && fp2(tp2) && (tp2 = null), np2 !== null && fp2(np2) && (np2 = null), rp2 !== null && fp2(rp2) && (rp2 = null), ip2.forEach(pp2), ap2.forEach(pp2);
  }
  function hp2(e3, n3) {
    e3.blockedOn === n3 && (e3.blockedOn = null, ep2 || (ep2 = true, t2.unstable_scheduleCallback(t2.unstable_NormalPriority, mp2)));
  }
  var gp2 = null;
  function _p2(e3) {
    gp2 !== e3 && (gp2 = e3, t2.unstable_scheduleCallback(t2.unstable_NormalPriority, function() {
      gp2 === e3 && (gp2 = null);
      for (var t3 = 0; t3 < e3.length; t3 += 3) {
        var n3 = e3[t3], r3 = e3[t3 + 1], i3 = e3[t3 + 2];
        if (typeof r3 != `function`) {
          if (Qf2(r3 || n3) === null) continue;
          break;
        }
        var a3 = _t2(n3);
        a3 !== null && (e3.splice(t3, 3), t3 -= 3, as2(a3, { pending: true, data: i3, method: n3.method, action: r3 }, r3, i3));
      }
    }));
  }
  function vp2(e3) {
    function t3(t4) {
      return hp2(t4, e3);
    }
    tp2 !== null && hp2(tp2, e3), np2 !== null && hp2(np2, e3), rp2 !== null && hp2(rp2, e3), ip2.forEach(t3), ap2.forEach(t3);
    for (var n3 = 0; n3 < op2.length; n3++) {
      var r3 = op2[n3];
      r3.blockedOn === e3 && (r3.blockedOn = null);
    }
    for (; 0 < op2.length && (n3 = op2[0], n3.blockedOn === null); ) dp2(n3), n3.blockedOn === null && op2.shift();
    if (n3 = (e3.ownerDocument || e3).$$reactFormReplay, n3 != null) for (r3 = 0; r3 < n3.length; r3 += 3) {
      var i3 = n3[r3], a3 = n3[r3 + 1], o3 = i3[ct2] || null;
      if (typeof a3 == `function`) o3 || _p2(n3);
      else if (o3) {
        var s3 = null;
        if (a3 && a3.hasAttribute(`formAction`)) {
          if (i3 = a3, o3 = a3[ct2] || null) s3 = o3.formAction;
          else if (Qf2(i3) !== null) continue;
        } else s3 = o3.action;
        typeof s3 == `function` ? n3[r3 + 1] = s3 : (n3.splice(r3, 3), r3 -= 3), _p2(n3);
      }
    }
  }
  function yp2(e3) {
    this._internalRoot = e3;
  }
  bp2.prototype.render = yp2.prototype.render = function(e3) {
    var t3 = this._internalRoot;
    if (t3 === null) throw Error(i2(409));
    var n3 = t3.current;
    Hf2(n3, au2(), e3, t3, null, null);
  }, bp2.prototype.unmount = yp2.prototype.unmount = function() {
    var e3 = this._internalRoot;
    if (e3 !== null) {
      this._internalRoot = null;
      var t3 = e3.containerInfo;
      Hf2(e3.current, 2, null, e3, null, null), fu2(), t3[lt2] = null;
    }
  };
  function bp2(e3) {
    this._internalRoot = e3;
  }
  bp2.prototype.unstable_scheduleHydration = function(e3) {
    if (e3) {
      var t3 = it2();
      e3 = { blockedOn: null, target: e3, priority: t3 };
      for (var n3 = 0; n3 < op2.length && t3 !== 0 && t3 < op2[n3].priority; n3++) ;
      op2.splice(n3, 0, e3), n3 === 0 && dp2(e3);
    }
  };
  var xp2 = n2.version;
  if (xp2 !== `19.1.0`) throw Error(i2(527, xp2, `19.1.0`));
  T2.findDOMNode = function(e3) {
    var t3 = e3._reactInternals;
    if (t3 === void 0) throw typeof e3.render == `function` ? Error(i2(188)) : (e3 = Object.keys(e3).join(`,`), Error(i2(268, e3)));
    return e3 = l2(t3), e3 = e3 === null ? null : u2(e3), e3 = e3 === null ? null : e3.stateNode, e3;
  };
  var Sp2 = { bundleType: 0, version: `19.1.0`, rendererPackageName: `react-dom`, currentDispatcherRef: w2, reconcilerVersion: `19.1.0` };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < `u`) {
    var Cp2 = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!Cp2.isDisabled && Cp2.supportsFiber) try {
      Le2 = Cp2.inject(Sp2), Re2 = Cp2;
    } catch {
    }
  }
  e2.createRoot = function(e3, t3) {
    if (!a2(e3)) throw Error(i2(299));
    var n3 = false, r3 = ``, o3 = Gs2, s3 = Ks2, c3 = qs2, l3 = null;
    return t3 != null && (true === t3.unstable_strictMode && (n3 = true), t3.identifierPrefix !== void 0 && (r3 = t3.identifierPrefix), t3.onUncaughtError !== void 0 && (o3 = t3.onUncaughtError), t3.onCaughtError !== void 0 && (s3 = t3.onCaughtError), t3.onRecoverableError !== void 0 && (c3 = t3.onRecoverableError), t3.unstable_transitionCallbacks !== void 0 && (l3 = t3.unstable_transitionCallbacks)), t3 = Bf2(e3, 1, false, null, null, n3, r3, o3, s3, c3, l3, null), e3[lt2] = t3.current, fd2(e3), new yp2(t3);
  };
})), Te = s(((e2, t2) => {
  function n2() {
    if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > `u` || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != `function`)) try {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n2);
    } catch (e3) {
      console.error(e3);
    }
  }
  n2(), t2.exports = we();
})), Ee = s(((e2) => {
  var t2 = Symbol.for(`react.transitional.element`), n2 = Symbol.for(`react.fragment`);
  function r2(e3, n3, r3) {
    var i2 = null;
    if (r3 !== void 0 && (i2 = `` + r3), n3.key !== void 0 && (i2 = `` + n3.key), `key` in n3) for (var a2 in r3 = {}, n3) a2 !== `key` && (r3[a2] = n3[a2]);
    else r3 = n3;
    return n3 = r3.ref, { $$typeof: t2, type: e3, key: i2, ref: n3 === void 0 ? null : n3, props: r3 };
  }
  e2.Fragment = n2, e2.jsx = r2, e2.jsxs = r2;
})), De = s(((e2, t2) => {
  t2.exports = Ee();
})), O = u(ye(), 1), Oe = (0, O.createContext)({});
function ke(e2) {
  let t2 = (0, O.useRef)(null);
  return t2.current === null && (t2.current = e2()), t2.current;
}
var Ae = typeof window < `u` ? O.useLayoutEffect : O.useEffect, je = (0, O.createContext)(null);
function Me(e2, t2) {
  e2.indexOf(t2) === -1 && e2.push(t2);
}
function Ne(e2, t2) {
  let n2 = e2.indexOf(t2);
  n2 > -1 && e2.splice(n2, 1);
}
var Pe = (e2, t2, n2) => n2 > t2 ? t2 : n2 < e2 ? e2 : n2, Fe = {}, Ie = (e2) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(e2), Le = (e2) => typeof e2 == `object` && !!e2, Re = (e2) => /^0[^.\s]+$/u.test(e2);
function ze(e2) {
  let t2;
  return () => (t2 === void 0 && (t2 = e2()), t2);
}
var k = (e2) => e2, Be = (...e2) => e2.reduce((e3, t2) => (n2) => t2(e3(n2))), Ve = (e2, t2, n2) => {
  let r2 = t2 - e2;
  return r2 ? (n2 - e2) / r2 : 1;
}, He = class {
  constructor() {
    this.subscriptions = [];
  }
  add(e2) {
    return Me(this.subscriptions, e2), () => Ne(this.subscriptions, e2);
  }
  notify(e2, t2, n2) {
    let r2 = this.subscriptions.length;
    if (r2) if (r2 === 1) this.subscriptions[0](e2, t2, n2);
    else for (let i2 = 0; i2 < r2; i2++) {
      let r3 = this.subscriptions[i2];
      r3 && r3(e2, t2, n2);
    }
  }
  getSize() {
    return this.subscriptions.length;
  }
  clear() {
    this.subscriptions.length = 0;
  }
}, Ue = (e2) => e2 * 1e3, We = (e2) => e2 / 1e3, Ge = (e2, t2) => t2 ? 1e3 / t2 * e2 : 0, Ke = (e2, t2, n2) => (((1 - 3 * n2 + 3 * t2) * e2 + (3 * n2 - 6 * t2)) * e2 + 3 * t2) * e2, qe = 1e-7, Je = 12;
function Ye(e2, t2, n2, r2, i2) {
  let a2, o2, s2 = 0;
  do
    o2 = t2 + (n2 - t2) / 2, a2 = Ke(o2, r2, i2) - e2, a2 > 0 ? n2 = o2 : t2 = o2;
  while (Math.abs(a2) > qe && ++s2 < Je);
  return o2;
}
function Xe(e2, t2, n2, r2) {
  if (e2 === t2 && n2 === r2) return k;
  let i2 = (t3) => Ye(t3, 0, 1, e2, n2);
  return (e3) => e3 === 0 || e3 === 1 ? e3 : Ke(i2(e3), t2, r2);
}
var Ze = (e2) => (t2) => t2 <= 0.5 ? e2(2 * t2) / 2 : (2 - e2(2 * (1 - t2))) / 2, Qe = (e2) => (t2) => 1 - e2(1 - t2), $e = Xe(0.33, 1.53, 0.69, 0.99), et = Qe($e), tt = Ze(et), nt = (e2) => e2 >= 1 ? 1 : (e2 *= 2) < 1 ? 0.5 * et(e2) : 0.5 * (2 - 2 ** (-10 * (e2 - 1))), rt = (e2) => 1 - Math.sin(Math.acos(e2)), it = Qe(rt), at = Ze(rt), ot = Xe(0.42, 0, 1, 1), st = Xe(0, 0, 0.58, 1), ct = Xe(0.42, 0, 0.58, 1), lt = (e2) => Array.isArray(e2) && typeof e2[0] != `number`, ut = (e2) => Array.isArray(e2) && typeof e2[0] == `number`, dt = { linear: k, easeIn: ot, easeInOut: ct, easeOut: st, circIn: rt, circInOut: at, circOut: it, backIn: et, backInOut: tt, backOut: $e, anticipate: nt }, ft = (e2) => typeof e2 == `string`, pt = (e2) => {
  if (ut(e2)) {
    e2.length;
    let [t2, n2, r2, i2] = e2;
    return Xe(t2, n2, r2, i2);
  } else if (ft(e2)) return dt[e2], `${e2}`, dt[e2];
  return e2;
}, mt = [`setup`, `read`, `resolveKeyframes`, `preUpdate`, `update`, `preRender`, `render`, `postRender`];
function ht(e2) {
  let t2 = /* @__PURE__ */ new Set(), n2 = /* @__PURE__ */ new Set(), r2 = false, i2 = false, a2 = /* @__PURE__ */ new WeakSet(), o2 = { delta: 0, timestamp: 0, isProcessing: false };
  function s2(t3) {
    a2.has(t3) && (c2.schedule(t3), e2()), t3(o2);
  }
  let c2 = { schedule: (e3, i3 = false, o3 = false) => {
    let s3 = o3 && r2 ? t2 : n2;
    return i3 && a2.add(e3), s3.add(e3), e3;
  }, cancel: (e3) => {
    n2.delete(e3), a2.delete(e3);
  }, process: (e3) => {
    if (o2 = e3, r2) {
      i2 = true;
      return;
    }
    r2 = true;
    let a3 = t2;
    t2 = n2, n2 = a3, t2.forEach(s2), t2.clear(), r2 = false, i2 && (i2 = false, c2.process(e3));
  } };
  return c2;
}
var gt = 40;
function _t(e2, t2) {
  let n2 = false, r2 = true, i2 = { delta: 0, timestamp: 0, isProcessing: false }, a2 = () => n2 = true, o2 = mt.reduce((e3, t3) => (e3[t3] = ht(a2), e3), {}), { setup: s2, read: c2, resolveKeyframes: l2, preUpdate: u2, update: d2, preRender: f2, render: p2, postRender: m2 } = o2, h2 = () => {
    let a3 = Fe.useManualTiming, o3 = a3 ? i2.timestamp : performance.now();
    n2 = false, a3 || (i2.delta = r2 ? 1e3 / 60 : Math.max(Math.min(o3 - i2.timestamp, gt), 1)), i2.timestamp = o3, i2.isProcessing = true, s2.process(i2), c2.process(i2), l2.process(i2), u2.process(i2), d2.process(i2), f2.process(i2), p2.process(i2), m2.process(i2), i2.isProcessing = false, n2 && t2 && (r2 = false, e2(h2));
  }, g2 = () => {
    n2 = true, r2 = true, i2.isProcessing || e2(h2);
  };
  return { schedule: mt.reduce((e3, t3) => {
    let r3 = o2[t3];
    return e3[t3] = (e4, t4 = false, i3 = false) => (n2 || g2(), r3.schedule(e4, t4, i3)), e3;
  }, {}), cancel: (e3) => {
    for (let t3 = 0; t3 < mt.length; t3++) o2[mt[t3]].cancel(e3);
  }, state: i2, steps: o2 };
}
var { schedule: A, cancel: vt, state: j, steps: yt } = _t(typeof requestAnimationFrame < `u` ? requestAnimationFrame : k, true), bt;
function xt() {
  bt = void 0;
}
var St = { now: () => (bt === void 0 && St.set(j.isProcessing || Fe.useManualTiming ? j.timestamp : performance.now()), bt), set: (e2) => {
  bt = e2, queueMicrotask(xt);
} }, Ct = (e2) => (t2) => typeof t2 == `string` && t2.startsWith(e2), wt = Ct(`--`), Tt = Ct(`var(--`), Et = (e2) => Tt(e2) ? Dt.test(e2.split(`/*`)[0].trim()) : false, Dt = /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;
function Ot(e2) {
  return typeof e2 == `string` && e2.split(`/*`)[0].includes(`var(--`);
}
var kt = { test: (e2) => typeof e2 == `number`, parse: parseFloat, transform: (e2) => e2 }, At = { ...kt, transform: (e2) => Pe(0, 1, e2) }, jt = { ...kt, default: 1 }, Mt = (e2) => Math.round(e2 * 1e5) / 1e5, Nt = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;
function Pt(e2) {
  return e2 == null;
}
var Ft = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu, It = (e2, t2) => (n2) => !!(typeof n2 == `string` && Ft.test(n2) && n2.startsWith(e2) || t2 && !Pt(n2) && Object.prototype.hasOwnProperty.call(n2, t2)), Lt = (e2, t2, n2) => (r2) => {
  if (typeof r2 != `string`) return r2;
  let [i2, a2, o2, s2] = r2.match(Nt);
  return { [e2]: parseFloat(i2), [t2]: parseFloat(a2), [n2]: parseFloat(o2), alpha: s2 === void 0 ? 1 : parseFloat(s2) };
}, Rt = (e2) => Pe(0, 255, e2), zt = { ...kt, transform: (e2) => Math.round(Rt(e2)) }, Bt = { test: It(`rgb`, `red`), parse: Lt(`red`, `green`, `blue`), transform: ({ red: e2, green: t2, blue: n2, alpha: r2 = 1 }) => `rgba(` + zt.transform(e2) + `, ` + zt.transform(t2) + `, ` + zt.transform(n2) + `, ` + Mt(At.transform(r2)) + `)` };
function Vt(e2) {
  let t2 = ``, n2 = ``, r2 = ``, i2 = ``;
  return e2.length > 5 ? (t2 = e2.substring(1, 3), n2 = e2.substring(3, 5), r2 = e2.substring(5, 7), i2 = e2.substring(7, 9)) : (t2 = e2.substring(1, 2), n2 = e2.substring(2, 3), r2 = e2.substring(3, 4), i2 = e2.substring(4, 5), t2 += t2, n2 += n2, r2 += r2, i2 += i2), { red: parseInt(t2, 16), green: parseInt(n2, 16), blue: parseInt(r2, 16), alpha: i2 ? parseInt(i2, 16) / 255 : 1 };
}
var Ht = { test: It(`#`), parse: Vt, transform: Bt.transform }, Ut = (e2) => ({ test: (t2) => typeof t2 == `string` && t2.endsWith(e2) && t2.split(` `).length === 1, parse: parseFloat, transform: (t2) => `${t2}${e2}` }), Wt = Ut(`deg`), Gt = Ut(`%`), M = Ut(`px`), Kt = Ut(`vh`), qt = Ut(`vw`), Jt = { ...Gt, parse: (e2) => Gt.parse(e2) / 100, transform: (e2) => Gt.transform(e2 * 100) }, Yt = { test: It(`hsl`, `hue`), parse: Lt(`hue`, `saturation`, `lightness`), transform: ({ hue: e2, saturation: t2, lightness: n2, alpha: r2 = 1 }) => `hsla(` + Math.round(e2) + `, ` + Gt.transform(Mt(t2)) + `, ` + Gt.transform(Mt(n2)) + `, ` + Mt(At.transform(r2)) + `)` }, N = { test: (e2) => Bt.test(e2) || Ht.test(e2) || Yt.test(e2), parse: (e2) => Bt.test(e2) ? Bt.parse(e2) : Yt.test(e2) ? Yt.parse(e2) : Ht.parse(e2), transform: (e2) => typeof e2 == `string` ? e2 : e2.hasOwnProperty(`red`) ? Bt.transform(e2) : Yt.transform(e2), getAnimatableNone: (e2) => {
  let t2 = N.parse(e2);
  return t2.alpha = 0, N.transform(t2);
} }, Xt = /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;
function Zt(e2) {
  return isNaN(e2) && typeof e2 == `string` && (e2.match(Nt)?.length || 0) + (e2.match(Xt)?.length || 0) > 0;
}
var Qt = `number`, $t = `color`, en = `var`, tn = `var(`, nn = "${}", rn = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;
function an(e2) {
  let t2 = e2.toString(), n2 = [], r2 = { color: [], number: [], var: [] }, i2 = [], a2 = 0;
  return { values: n2, split: t2.replace(rn, (e3) => (N.test(e3) ? (r2.color.push(a2), i2.push($t), n2.push(N.parse(e3))) : e3.startsWith(tn) ? (r2.var.push(a2), i2.push(en), n2.push(e3)) : (r2.number.push(a2), i2.push(Qt), n2.push(parseFloat(e3))), ++a2, nn)).split(nn), indexes: r2, types: i2 };
}
function on(e2) {
  return an(e2).values;
}
function sn({ split: e2, types: t2 }) {
  let n2 = e2.length;
  return (r2) => {
    let i2 = ``;
    for (let a2 = 0; a2 < n2; a2++) if (i2 += e2[a2], r2[a2] !== void 0) {
      let e3 = t2[a2];
      e3 === Qt ? i2 += Mt(r2[a2]) : e3 === $t ? i2 += N.transform(r2[a2]) : i2 += r2[a2];
    }
    return i2;
  };
}
function cn(e2) {
  return sn(an(e2));
}
var ln = (e2) => typeof e2 == `number` ? 0 : N.test(e2) ? N.getAnimatableNone(e2) : e2, un = (e2, t2) => typeof e2 == `number` ? t2?.trim().endsWith(`/`) ? e2 : 0 : ln(e2);
function dn(e2) {
  let t2 = an(e2);
  return sn(t2)(t2.values.map((e3, n2) => un(e3, t2.split[n2])));
}
var fn = { test: Zt, parse: on, createTransformer: cn, getAnimatableNone: dn };
function pn(e2, t2, n2) {
  return n2 < 0 && (n2 += 1), n2 > 1 && --n2, n2 < 1 / 6 ? e2 + (t2 - e2) * 6 * n2 : n2 < 1 / 2 ? t2 : n2 < 2 / 3 ? e2 + (t2 - e2) * (2 / 3 - n2) * 6 : e2;
}
function mn({ hue: e2, saturation: t2, lightness: n2, alpha: r2 }) {
  e2 /= 360, t2 /= 100, n2 /= 100;
  let i2 = 0, a2 = 0, o2 = 0;
  if (!t2) i2 = a2 = o2 = n2;
  else {
    let r3 = n2 < 0.5 ? n2 * (1 + t2) : n2 + t2 - n2 * t2, s2 = 2 * n2 - r3;
    i2 = pn(s2, r3, e2 + 1 / 3), a2 = pn(s2, r3, e2), o2 = pn(s2, r3, e2 - 1 / 3);
  }
  return { red: Math.round(i2 * 255), green: Math.round(a2 * 255), blue: Math.round(o2 * 255), alpha: r2 };
}
function hn(e2, t2) {
  return (n2) => n2 > 0 ? t2 : e2;
}
var P = (e2, t2, n2) => e2 + (t2 - e2) * n2, gn = (e2, t2, n2) => {
  let r2 = e2 * e2, i2 = n2 * (t2 * t2 - r2) + r2;
  return i2 < 0 ? 0 : Math.sqrt(i2);
}, _n = [Ht, Bt, Yt], vn = (e2) => _n.find((t2) => t2.test(e2));
function yn(e2) {
  let t2 = vn(e2);
  if (`${e2}`, !t2) return false;
  let n2 = t2.parse(e2);
  return t2 === Yt && (n2 = mn(n2)), n2;
}
var bn = (e2, t2) => {
  let n2 = yn(e2), r2 = yn(t2);
  if (!n2 || !r2) return hn(e2, t2);
  let i2 = { ...n2 };
  return (e3) => (i2.red = gn(n2.red, r2.red, e3), i2.green = gn(n2.green, r2.green, e3), i2.blue = gn(n2.blue, r2.blue, e3), i2.alpha = P(n2.alpha, r2.alpha, e3), Bt.transform(i2));
}, xn = /* @__PURE__ */ new Set([`none`, `hidden`]);
function Sn(e2, t2) {
  return xn.has(e2) ? (n2) => n2 <= 0 ? e2 : t2 : (n2) => n2 >= 1 ? t2 : e2;
}
function Cn(e2, t2) {
  return (n2) => P(e2, t2, n2);
}
function wn(e2) {
  return typeof e2 == `number` ? Cn : typeof e2 == `string` ? Et(e2) ? hn : N.test(e2) ? bn : On : Array.isArray(e2) ? Tn : typeof e2 == `object` ? N.test(e2) ? bn : En : hn;
}
function Tn(e2, t2) {
  let n2 = [...e2], r2 = n2.length, i2 = e2.map((e3, n3) => wn(e3)(e3, t2[n3]));
  return (e3) => {
    for (let t3 = 0; t3 < r2; t3++) n2[t3] = i2[t3](e3);
    return n2;
  };
}
function En(e2, t2) {
  let n2 = { ...e2, ...t2 }, r2 = {};
  for (let i2 in n2) e2[i2] !== void 0 && t2[i2] !== void 0 && (r2[i2] = wn(e2[i2])(e2[i2], t2[i2]));
  return (e3) => {
    for (let t3 in r2) n2[t3] = r2[t3](e3);
    return n2;
  };
}
function Dn(e2, t2) {
  let n2 = [], r2 = { color: 0, var: 0, number: 0 };
  for (let i2 = 0; i2 < t2.values.length; i2++) {
    let a2 = t2.types[i2], o2 = e2.indexes[a2][r2[a2]];
    n2[i2] = e2.values[o2] ?? 0, r2[a2]++;
  }
  return n2;
}
var On = (e2, t2) => {
  let n2 = fn.createTransformer(t2), r2 = an(e2), i2 = an(t2);
  return r2.indexes.var.length === i2.indexes.var.length && r2.indexes.color.length === i2.indexes.color.length && r2.indexes.number.length >= i2.indexes.number.length ? xn.has(e2) && !i2.values.length || xn.has(t2) && !r2.values.length ? Sn(e2, t2) : Be(Tn(Dn(r2, i2), i2.values), n2) : (`${e2}${t2}`, hn(e2, t2));
};
function kn(e2, t2, n2) {
  return typeof e2 == `number` && typeof t2 == `number` && typeof n2 == `number` ? P(e2, t2, n2) : wn(e2)(e2, t2);
}
var An = (e2) => {
  let t2 = ({ timestamp: t3 }) => e2(t3);
  return { start: (e3 = true) => A.update(t2, e3), stop: () => vt(t2), now: () => j.isProcessing ? j.timestamp : St.now() };
}, jn = (e2, t2, n2 = 10) => {
  let r2 = ``, i2 = Math.max(Math.round(t2 / n2), 2);
  for (let t3 = 0; t3 < i2; t3++) r2 += Math.round(e2(t3 / (i2 - 1)) * 1e4) / 1e4 + `, `;
  return `linear(${r2.substring(0, r2.length - 2)})`;
}, Mn = 2e4;
function Nn(e2) {
  let t2 = 0, n2 = e2.next(t2);
  for (; !n2.done && t2 < 2e4; ) t2 += 50, n2 = e2.next(t2);
  return t2 >= 2e4 ? 1 / 0 : t2;
}
function Pn(e2, t2 = 100, n2) {
  let r2 = n2({ ...e2, keyframes: [0, t2] }), i2 = Math.min(Nn(r2), Mn);
  return { type: `keyframes`, ease: (e3) => r2.next(i2 * e3).value / t2, duration: We(i2) };
}
var F = { stiffness: 100, damping: 10, mass: 1, velocity: 0, duration: 800, bounce: 0.3, visualDuration: 0.3, restSpeed: { granular: 0.01, default: 2 }, restDelta: { granular: 5e-3, default: 0.5 }, minDuration: 0.01, maxDuration: 10, minDamping: 0.05, maxDamping: 1 };
function Fn(e2, t2) {
  return e2 * Math.sqrt(1 - t2 * t2);
}
var In = 12;
function Ln(e2, t2, n2) {
  let r2 = n2;
  for (let n3 = 1; n3 < In; n3++) r2 -= e2(r2) / t2(r2);
  return r2;
}
var Rn = 1e-3;
function zn({ duration: e2 = F.duration, bounce: t2 = F.bounce, velocity: n2 = F.velocity, mass: r2 = F.mass }) {
  let i2, a2;
  F.maxDuration;
  let o2 = 1 - t2;
  o2 = Pe(F.minDamping, F.maxDamping, o2), e2 = Pe(F.minDuration, F.maxDuration, We(e2)), o2 < 1 ? (i2 = (t3) => {
    let r3 = t3 * o2, i3 = r3 * e2, a3 = r3 - n2, s3 = Fn(t3, o2), c3 = Math.exp(-i3);
    return Rn - a3 / s3 * c3;
  }, a2 = (t3) => {
    let r3 = t3 * o2 * e2, a3 = r3 * n2 + n2, s3 = o2 ** 2 * t3 ** 2 * e2, c3 = Math.exp(-r3), l2 = Fn(t3 ** 2, o2);
    return (-i2(t3) + Rn > 0 ? -1 : 1) * ((a3 - s3) * c3) / l2;
  }) : (i2 = (t3) => -1e-3 + Math.exp(-t3 * e2) * ((t3 - n2) * e2 + 1), a2 = (t3) => Math.exp(-t3 * e2) * ((n2 - t3) * (e2 * e2)));
  let s2 = 5 / e2, c2 = Ln(i2, a2, s2);
  if (e2 = Ue(e2), isNaN(c2)) return { stiffness: F.stiffness, damping: F.damping, duration: e2 };
  {
    let t3 = c2 ** 2 * r2;
    return { stiffness: t3, damping: o2 * 2 * Math.sqrt(r2 * t3), duration: e2 };
  }
}
var Bn = [`duration`, `bounce`], Vn = [`stiffness`, `damping`, `mass`];
function Hn(e2, t2) {
  return t2.some((t3) => e2[t3] !== void 0);
}
function Un(e2) {
  let t2 = { velocity: F.velocity, stiffness: F.stiffness, damping: F.damping, mass: F.mass, isResolvedFromDuration: false, ...e2 };
  if (!Hn(e2, Vn) && Hn(e2, Bn)) if (t2.velocity = 0, e2.visualDuration) {
    let n2 = e2.visualDuration, r2 = 2 * Math.PI / (n2 * 1.2), i2 = r2 * r2, a2 = 2 * Pe(0.05, 1, 1 - (e2.bounce || 0)) * Math.sqrt(i2);
    t2 = { ...t2, mass: F.mass, stiffness: i2, damping: a2 };
  } else {
    let n2 = zn({ ...e2, velocity: 0 });
    t2 = { ...t2, ...n2, mass: F.mass }, t2.isResolvedFromDuration = true;
  }
  return t2;
}
function Wn(e2 = F.visualDuration, t2 = F.bounce) {
  let n2 = typeof e2 == `object` ? e2 : { visualDuration: e2, keyframes: [0, 1], bounce: t2 }, { restSpeed: r2, restDelta: i2 } = n2, a2 = n2.keyframes[0], o2 = n2.keyframes[n2.keyframes.length - 1], s2 = { done: false, value: a2 }, { stiffness: c2, damping: l2, mass: u2, duration: d2, velocity: f2, isResolvedFromDuration: p2 } = Un({ ...n2, velocity: -We(n2.velocity || 0) }), m2 = f2 || 0, h2 = l2 / (2 * Math.sqrt(c2 * u2)), g2 = o2 - a2, _2 = We(Math.sqrt(c2 / u2)), v2 = Math.abs(g2) < 5;
  r2 ||= v2 ? F.restSpeed.granular : F.restSpeed.default, i2 ||= v2 ? F.restDelta.granular : F.restDelta.default;
  let y2, b2, x2, S2, C2, ee2;
  if (h2 < 1) x2 = Fn(_2, h2), S2 = (m2 + h2 * _2 * g2) / x2, y2 = (e3) => {
    let t3 = Math.exp(-h2 * _2 * e3);
    return o2 - t3 * (S2 * Math.sin(x2 * e3) + g2 * Math.cos(x2 * e3));
  }, C2 = h2 * _2 * S2 + g2 * x2, ee2 = h2 * _2 * g2 - S2 * x2, b2 = (e3) => Math.exp(-h2 * _2 * e3) * (C2 * Math.sin(x2 * e3) + ee2 * Math.cos(x2 * e3));
  else if (h2 === 1) {
    y2 = (e4) => o2 - Math.exp(-_2 * e4) * (g2 + (m2 + _2 * g2) * e4);
    let e3 = m2 + _2 * g2;
    b2 = (t3) => Math.exp(-_2 * t3) * (_2 * e3 * t3 - m2);
  } else {
    let e3 = _2 * Math.sqrt(h2 * h2 - 1);
    y2 = (t4) => {
      let n4 = Math.exp(-h2 * _2 * t4), r4 = Math.min(e3 * t4, 300);
      return o2 - n4 * ((m2 + h2 * _2 * g2) * Math.sinh(r4) + e3 * g2 * Math.cosh(r4)) / e3;
    };
    let t3 = (m2 + h2 * _2 * g2) / e3, n3 = h2 * _2 * t3 - g2 * e3, r3 = h2 * _2 * g2 - t3 * e3;
    b2 = (t4) => {
      let i3 = Math.exp(-h2 * _2 * t4), a3 = Math.min(e3 * t4, 300);
      return i3 * (n3 * Math.sinh(a3) + r3 * Math.cosh(a3));
    };
  }
  let te2 = { calculatedDuration: p2 && d2 || null, velocity: (e3) => Ue(b2(e3)), next: (e3) => {
    if (!p2 && h2 < 1) {
      let t4 = Math.exp(-h2 * _2 * e3), n3 = Math.sin(x2 * e3), a3 = Math.cos(x2 * e3), c3 = o2 - t4 * (S2 * n3 + g2 * a3), l3 = Ue(t4 * (C2 * n3 + ee2 * a3));
      return s2.done = Math.abs(l3) <= r2 && Math.abs(o2 - c3) <= i2, s2.value = s2.done ? o2 : c3, s2;
    }
    let t3 = y2(e3);
    if (p2) s2.done = e3 >= d2;
    else {
      let n3 = Ue(b2(e3));
      s2.done = Math.abs(n3) <= r2 && Math.abs(o2 - t3) <= i2;
    }
    return s2.value = s2.done ? o2 : t3, s2;
  }, toString: () => {
    let e3 = Math.min(Nn(te2), Mn), t3 = jn((t4) => te2.next(e3 * t4).value, e3, 30);
    return e3 + `ms ` + t3;
  }, toTransition: () => {
  } };
  return te2;
}
Wn.applyToOptions = (e2) => {
  let t2 = Pn(e2, 100, Wn);
  return e2.ease = t2.ease, e2.duration = Ue(t2.duration), e2.type = `keyframes`, e2;
};
var Gn = 5;
function Kn(e2, t2, n2) {
  let r2 = Math.max(t2 - Gn, 0);
  return Ge(n2 - e2(r2), t2 - r2);
}
function qn({ keyframes: e2, velocity: t2 = 0, power: n2 = 0.8, timeConstant: r2 = 325, bounceDamping: i2 = 10, bounceStiffness: a2 = 500, modifyTarget: o2, min: s2, max: c2, restDelta: l2 = 0.5, restSpeed: u2 }) {
  let d2 = e2[0], f2 = { done: false, value: d2 }, p2 = (e3) => s2 !== void 0 && e3 < s2 || c2 !== void 0 && e3 > c2, m2 = (e3) => s2 === void 0 ? c2 : c2 === void 0 || Math.abs(s2 - e3) < Math.abs(c2 - e3) ? s2 : c2, h2 = n2 * t2, g2 = d2 + h2, _2 = o2 === void 0 ? g2 : o2(g2);
  _2 !== g2 && (h2 = _2 - d2);
  let v2 = (e3) => -h2 * Math.exp(-e3 / r2), y2 = (e3) => _2 + v2(e3), b2 = (e3) => {
    let t3 = v2(e3), n3 = y2(e3);
    f2.done = Math.abs(t3) <= l2, f2.value = f2.done ? _2 : n3;
  }, x2, S2, C2 = (e3) => {
    p2(f2.value) && (x2 = e3, S2 = Wn({ keyframes: [f2.value, m2(f2.value)], velocity: Kn(y2, e3, f2.value), damping: i2, stiffness: a2, restDelta: l2, restSpeed: u2 }));
  };
  return C2(0), { calculatedDuration: null, next: (e3) => {
    let t3 = false;
    return !S2 && x2 === void 0 && (t3 = true, b2(e3), C2(e3)), x2 !== void 0 && e3 >= x2 ? S2.next(e3 - x2) : (!t3 && b2(e3), f2);
  } };
}
function Jn(e2, t2, n2) {
  let r2 = [], i2 = n2 || Fe.mix || kn, a2 = e2.length - 1;
  for (let n3 = 0; n3 < a2; n3++) {
    let a3 = i2(e2[n3], e2[n3 + 1]);
    t2 && (a3 = Be(Array.isArray(t2) ? t2[n3] || k : t2, a3)), r2.push(a3);
  }
  return r2;
}
function Yn(e2, t2, { clamp: n2 = true, ease: r2, mixer: i2 } = {}) {
  let a2 = e2.length;
  if (t2.length, a2 === 1) return () => t2[0];
  if (a2 === 2 && t2[0] === t2[1]) return () => t2[1];
  let o2 = e2[0] === e2[1];
  e2[0] > e2[a2 - 1] && (e2 = [...e2].reverse(), t2 = [...t2].reverse());
  let s2 = Jn(t2, r2, i2), c2 = s2.length, l2 = (n3) => {
    if (o2 && n3 < e2[0]) return t2[0];
    let r3 = 0;
    if (c2 > 1) for (; r3 < e2.length - 2 && !(n3 < e2[r3 + 1]); r3++) ;
    let i3 = Ve(e2[r3], e2[r3 + 1], n3);
    return s2[r3](i3);
  };
  return n2 ? (t3) => l2(Pe(e2[0], e2[a2 - 1], t3)) : l2;
}
function Xn(e2, t2) {
  let n2 = e2[e2.length - 1];
  for (let r2 = 1; r2 <= t2; r2++) {
    let i2 = Ve(0, t2, r2);
    e2.push(P(n2, 1, i2));
  }
}
function Zn(e2) {
  let t2 = [0];
  return Xn(t2, e2.length - 1), t2;
}
function Qn(e2, t2) {
  return e2.map((e3) => e3 * t2);
}
function $n(e2, t2) {
  return e2.map(() => t2 || ct).splice(0, e2.length - 1);
}
function er({ duration: e2 = 300, keyframes: t2, times: n2, ease: r2 = `easeInOut` }) {
  let i2 = lt(r2) ? r2.map(pt) : pt(r2), a2 = { done: false, value: t2[0] }, o2 = Yn(Qn(n2 && n2.length === t2.length ? n2 : Zn(t2), e2), t2, { ease: Array.isArray(i2) ? i2 : $n(t2, i2) });
  return { calculatedDuration: e2, next: (t3) => (a2.value = o2(t3), a2.done = t3 >= e2, a2) };
}
var tr = (e2) => e2 !== null;
function nr(e2, { repeat: t2, repeatType: n2 = `loop` }, r2, i2 = 1) {
  let a2 = e2.filter(tr), o2 = i2 < 0 || t2 && n2 !== `loop` && t2 % 2 == 1 ? 0 : a2.length - 1;
  return !o2 || r2 === void 0 ? a2[o2] : r2;
}
var rr = { decay: qn, inertia: qn, tween: er, keyframes: er, spring: Wn };
function ir(e2) {
  typeof e2.type == `string` && (e2.type = rr[e2.type]);
}
var ar = class {
  constructor() {
    this.updateFinished();
  }
  get finished() {
    return this._finished;
  }
  updateFinished() {
    this._finished = new Promise((e2) => {
      this.resolve = e2;
    });
  }
  notifyFinished() {
    this.resolve();
  }
  then(e2, t2) {
    return this.finished.then(e2, t2);
  }
}, or = (e2) => e2 / 100, sr = class extends ar {
  constructor(e2) {
    super(), this.state = `idle`, this.startTime = null, this.isStopped = false, this.currentTime = 0, this.holdTime = null, this.playbackSpeed = 1, this.delayState = { done: false, value: void 0 }, this.stop = () => {
      let { motionValue: e3 } = this.options;
      e3 && e3.updatedAt !== St.now() && this.tick(St.now()), this.isStopped = true, this.state !== `idle` && (this.teardown(), this.options.onStop?.());
    }, this.options = e2, this.initAnimation(), this.play(), e2.autoplay === false && this.pause();
  }
  initAnimation() {
    let { options: e2 } = this;
    ir(e2);
    let { type: t2 = er, repeat: n2 = 0, repeatDelay: r2 = 0, repeatType: i2, velocity: a2 = 0 } = e2, { keyframes: o2 } = e2, s2 = t2 || er;
    s2 !== er && typeof o2[0] != `number` && (this.mixKeyframes = Be(or, kn(o2[0], o2[1])), o2 = [0, 100]);
    let c2 = s2({ ...e2, keyframes: o2 });
    i2 === `mirror` && (this.mirroredGenerator = s2({ ...e2, keyframes: [...o2].reverse(), velocity: -a2 })), c2.calculatedDuration === null && (c2.calculatedDuration = Nn(c2));
    let { calculatedDuration: l2 } = c2;
    this.calculatedDuration = l2, this.resolvedDuration = l2 + r2, this.totalDuration = this.resolvedDuration * (n2 + 1) - r2, this.generator = c2;
  }
  updateTime(e2) {
    let t2 = Math.round(e2 - this.startTime) * this.playbackSpeed;
    this.holdTime === null ? this.currentTime = t2 : this.currentTime = this.holdTime;
  }
  tick(e2, t2 = false) {
    let { generator: n2, totalDuration: r2, mixKeyframes: i2, mirroredGenerator: a2, resolvedDuration: o2, calculatedDuration: s2 } = this;
    if (this.startTime === null) return n2.next(0);
    let { delay: c2 = 0, keyframes: l2, repeat: u2, repeatType: d2, repeatDelay: f2, type: p2, onUpdate: m2, finalKeyframe: h2 } = this.options;
    this.speed > 0 ? this.startTime = Math.min(this.startTime, e2) : this.speed < 0 && (this.startTime = Math.min(e2 - r2 / this.speed, this.startTime)), t2 ? this.currentTime = e2 : this.updateTime(e2);
    let g2 = this.currentTime - c2 * (this.playbackSpeed >= 0 ? 1 : -1), _2 = this.playbackSpeed >= 0 ? g2 < 0 : g2 > r2;
    this.currentTime = Math.max(g2, 0), this.state === `finished` && this.holdTime === null && (this.currentTime = r2);
    let v2 = this.currentTime, y2 = n2;
    if (u2) {
      let e3 = Math.min(this.currentTime, r2) / o2, t3 = Math.floor(e3), n3 = e3 % 1;
      !n3 && e3 >= 1 && (n3 = 1), n3 === 1 && t3--, t3 = Math.min(t3, u2 + 1), t3 % 2 && (d2 === `reverse` ? (n3 = 1 - n3, f2 && (n3 -= f2 / o2)) : d2 === `mirror` && (y2 = a2)), v2 = Pe(0, 1, n3) * o2;
    }
    let b2;
    _2 ? (this.delayState.value = l2[0], b2 = this.delayState) : b2 = y2.next(v2), i2 && !_2 && (b2.value = i2(b2.value));
    let { done: x2 } = b2;
    !_2 && s2 !== null && (x2 = this.playbackSpeed >= 0 ? this.currentTime >= r2 : this.currentTime <= 0);
    let S2 = this.holdTime === null && (this.state === `finished` || this.state === `running` && x2);
    return S2 && p2 !== qn && (b2.value = nr(l2, this.options, h2, this.speed)), m2 && m2(b2.value), S2 && this.finish(), b2;
  }
  then(e2, t2) {
    return this.finished.then(e2, t2);
  }
  get duration() {
    return We(this.calculatedDuration);
  }
  get iterationDuration() {
    let { delay: e2 = 0 } = this.options || {};
    return this.duration + We(e2);
  }
  get time() {
    return We(this.currentTime);
  }
  set time(e2) {
    e2 = Ue(e2), this.currentTime = e2, this.startTime === null || this.holdTime !== null || this.playbackSpeed === 0 ? this.holdTime = e2 : this.driver && (this.startTime = this.driver.now() - e2 / this.playbackSpeed), this.driver ? this.driver.start(false) : (this.startTime = 0, this.state = `paused`, this.holdTime = e2, this.tick(e2));
  }
  getGeneratorVelocity() {
    let e2 = this.currentTime;
    if (e2 <= 0) return this.options.velocity || 0;
    if (this.generator.velocity) return this.generator.velocity(e2);
    let t2 = this.generator.next(e2).value;
    return Kn((e3) => this.generator.next(e3).value, e2, t2);
  }
  get speed() {
    return this.playbackSpeed;
  }
  set speed(e2) {
    let t2 = this.playbackSpeed !== e2;
    t2 && this.driver && this.updateTime(St.now()), this.playbackSpeed = e2, t2 && this.driver && (this.time = We(this.currentTime));
  }
  play() {
    if (this.isStopped) return;
    let { driver: e2 = An, startTime: t2 } = this.options;
    this.driver ||= e2((e3) => this.tick(e3)), this.options.onPlay?.();
    let n2 = this.driver.now();
    this.state === `finished` ? (this.updateFinished(), this.startTime = n2) : this.holdTime === null ? this.startTime ||= t2 ?? n2 : this.startTime = n2 - this.holdTime, this.state === `finished` && this.speed < 0 && (this.startTime += this.calculatedDuration), this.holdTime = null, this.state = `running`, this.driver.start();
  }
  pause() {
    this.state = `paused`, this.updateTime(St.now()), this.holdTime = this.currentTime;
  }
  complete() {
    this.state !== `running` && this.play(), this.state = `finished`, this.holdTime = null;
  }
  finish() {
    this.notifyFinished(), this.teardown(), this.state = `finished`, this.options.onComplete?.();
  }
  cancel() {
    this.holdTime = null, this.startTime = 0, this.tick(0), this.teardown(), this.options.onCancel?.();
  }
  teardown() {
    this.state = `idle`, this.stopDriver(), this.startTime = this.holdTime = null;
  }
  stopDriver() {
    this.driver &&= (this.driver.stop(), void 0);
  }
  sample(e2) {
    return this.startTime = 0, this.tick(e2, true);
  }
  attachTimeline(e2) {
    return this.options.allowFlatten && (this.options.type = `keyframes`, this.options.ease = `linear`, this.initAnimation()), this.driver?.stop(), e2.observe(this);
  }
};
function cr(e2) {
  for (let t2 = 1; t2 < e2.length; t2++) e2[t2] ?? (e2[t2] = e2[t2 - 1]);
}
var lr = (e2) => e2 * 180 / Math.PI, ur = (e2) => fr(lr(Math.atan2(e2[1], e2[0]))), dr = { x: 4, y: 5, translateX: 4, translateY: 5, scaleX: 0, scaleY: 3, scale: (e2) => (Math.abs(e2[0]) + Math.abs(e2[3])) / 2, rotate: ur, rotateZ: ur, skewX: (e2) => lr(Math.atan(e2[1])), skewY: (e2) => lr(Math.atan(e2[2])), skew: (e2) => (Math.abs(e2[1]) + Math.abs(e2[2])) / 2 }, fr = (e2) => (e2 %= 360, e2 < 0 && (e2 += 360), e2), pr = ur, mr = (e2) => Math.sqrt(e2[0] * e2[0] + e2[1] * e2[1]), hr = (e2) => Math.sqrt(e2[4] * e2[4] + e2[5] * e2[5]), gr = { x: 12, y: 13, z: 14, translateX: 12, translateY: 13, translateZ: 14, scaleX: mr, scaleY: hr, scale: (e2) => (mr(e2) + hr(e2)) / 2, rotateX: (e2) => fr(lr(Math.atan2(e2[6], e2[5]))), rotateY: (e2) => fr(lr(Math.atan2(-e2[2], e2[0]))), rotateZ: pr, rotate: pr, skewX: (e2) => lr(Math.atan(e2[4])), skewY: (e2) => lr(Math.atan(e2[1])), skew: (e2) => (Math.abs(e2[1]) + Math.abs(e2[4])) / 2 };
function _r(e2) {
  return +!!e2.includes(`scale`);
}
function vr(e2, t2) {
  if (!e2 || e2 === `none`) return _r(t2);
  let n2 = e2.match(/^matrix3d\(([-\d.e\s,]+)\)$/u), r2, i2;
  if (n2) r2 = gr, i2 = n2;
  else {
    let t3 = e2.match(/^matrix\(([-\d.e\s,]+)\)$/u);
    r2 = dr, i2 = t3;
  }
  if (!i2) return _r(t2);
  let a2 = r2[t2], o2 = i2[1].split(`,`).map(br);
  return typeof a2 == `function` ? a2(o2) : o2[a2];
}
var yr = (e2, t2) => {
  let { transform: n2 = `none` } = getComputedStyle(e2);
  return vr(n2, t2);
};
function br(e2) {
  return parseFloat(e2.trim());
}
var xr = [`transformPerspective`, `x`, `y`, `z`, `translateX`, `translateY`, `translateZ`, `scale`, `scaleX`, `scaleY`, `rotate`, `rotateX`, `rotateY`, `rotateZ`, `skew`, `skewX`, `skewY`], Sr = /* @__PURE__ */ new Set([...xr, `pathRotation`]), Cr = (e2) => e2 === kt || e2 === M, wr = /* @__PURE__ */ new Set([`x`, `y`, `z`]), Tr = xr.filter((e2) => !wr.has(e2));
function Er(e2) {
  let t2 = [];
  return Tr.forEach((n2) => {
    let r2 = e2.getValue(n2);
    r2 !== void 0 && (t2.push([n2, r2.get()]), r2.set(+!!n2.startsWith(`scale`)));
  }), t2;
}
var Dr = { width: ({ x: e2 }, { paddingLeft: t2 = `0`, paddingRight: n2 = `0`, boxSizing: r2 }) => {
  let i2 = e2.max - e2.min;
  return r2 === `border-box` ? i2 : i2 - parseFloat(t2) - parseFloat(n2);
}, height: ({ y: e2 }, { paddingTop: t2 = `0`, paddingBottom: n2 = `0`, boxSizing: r2 }) => {
  let i2 = e2.max - e2.min;
  return r2 === `border-box` ? i2 : i2 - parseFloat(t2) - parseFloat(n2);
}, top: (e2, { top: t2 }) => parseFloat(t2), left: (e2, { left: t2 }) => parseFloat(t2), bottom: ({ y: e2 }, { top: t2 }) => parseFloat(t2) + (e2.max - e2.min), right: ({ x: e2 }, { left: t2 }) => parseFloat(t2) + (e2.max - e2.min), x: (e2, { transform: t2 }) => vr(t2, `x`), y: (e2, { transform: t2 }) => vr(t2, `y`) };
Dr.translateX = Dr.x, Dr.translateY = Dr.y;
var Or = /* @__PURE__ */ new Set(), kr = false, Ar = false, jr = false;
function Mr() {
  if (Ar) {
    let e2 = Array.from(Or).filter((e3) => e3.needsMeasurement), t2 = new Set(e2.map((e3) => e3.element)), n2 = /* @__PURE__ */ new Map();
    t2.forEach((e3) => {
      let t3 = Er(e3);
      t3.length && (n2.set(e3, t3), e3.render());
    }), e2.forEach((e3) => e3.measureInitialState()), t2.forEach((e3) => {
      e3.render();
      let t3 = n2.get(e3);
      t3 && t3.forEach(([t4, n3]) => {
        e3.getValue(t4)?.set(n3);
      });
    }), e2.forEach((e3) => e3.measureEndState()), e2.forEach((e3) => {
      e3.suspendedScrollY !== void 0 && window.scrollTo(0, e3.suspendedScrollY);
    });
  }
  Ar = false, kr = false, Or.forEach((e2) => e2.complete(jr)), Or.clear();
}
function Nr() {
  Or.forEach((e2) => {
    e2.readKeyframes(), e2.needsMeasurement && (Ar = true);
  });
}
function Pr() {
  jr = true, Nr(), Mr(), jr = false;
}
var Fr = class {
  constructor(e2, t2, n2, r2, i2, a2 = false) {
    this.state = `pending`, this.isAsync = false, this.needsMeasurement = false, this.unresolvedKeyframes = [...e2], this.onComplete = t2, this.name = n2, this.motionValue = r2, this.element = i2, this.isAsync = a2;
  }
  scheduleResolve() {
    this.state = `scheduled`, this.isAsync ? (Or.add(this), kr || (kr = true, A.read(Nr), A.resolveKeyframes(Mr))) : (this.readKeyframes(), this.complete());
  }
  readKeyframes() {
    let { unresolvedKeyframes: e2, name: t2, element: n2, motionValue: r2 } = this;
    if (e2[0] === null) {
      let i2 = r2?.get(), a2 = e2[e2.length - 1];
      if (i2 !== void 0) e2[0] = i2;
      else if (n2 && t2) {
        let r3 = n2.readValue(t2, a2);
        r3 != null && (e2[0] = r3);
      }
      e2[0] === void 0 && (e2[0] = a2), r2 && i2 === void 0 && r2.set(e2[0]);
    }
    cr(e2);
  }
  setFinalKeyframe() {
  }
  measureInitialState() {
  }
  renderEndStyles() {
  }
  measureEndState() {
  }
  complete(e2 = false) {
    this.state = `complete`, this.onComplete(this.unresolvedKeyframes, this.finalKeyframe, e2), Or.delete(this);
  }
  cancel() {
    this.state === `scheduled` && (Or.delete(this), this.state = `pending`);
  }
  resume() {
    this.state === `pending` && this.scheduleResolve();
  }
}, Ir = (e2) => e2.startsWith(`--`);
function Lr(e2, t2, n2) {
  Ir(t2) ? e2.style.setProperty(t2, n2) : e2.style[t2] = n2;
}
var Rr = {};
function zr(e2, t2) {
  let n2 = ze(e2);
  return () => Rr[t2] ?? n2();
}
var Br = zr(() => window.ScrollTimeline !== void 0, `scrollTimeline`), Vr = zr(() => {
  try {
    document.createElement(`div`).animate({ opacity: 0 }, { easing: `linear(0, 1)` });
  } catch {
    return false;
  }
  return true;
}, `linearEasing`), Hr = ([e2, t2, n2, r2]) => `cubic-bezier(${e2}, ${t2}, ${n2}, ${r2})`, Ur = { linear: `linear`, ease: `ease`, easeIn: `ease-in`, easeOut: `ease-out`, easeInOut: `ease-in-out`, circIn: Hr([0, 0.65, 0.55, 1]), circOut: Hr([0.55, 0, 1, 0.45]), backIn: Hr([0.31, 0.01, 0.66, -0.59]), backOut: Hr([0.33, 1.53, 0.69, 0.99]) };
function Wr(e2, t2) {
  if (e2) return typeof e2 == `function` ? Vr() ? jn(e2, t2) : `ease-out` : ut(e2) ? Hr(e2) : Array.isArray(e2) ? e2.map((e3) => Wr(e3, t2) || Ur.easeOut) : Ur[e2];
}
function Gr(e2, t2, n2, { delay: r2 = 0, duration: i2 = 300, repeat: a2 = 0, repeatType: o2 = `loop`, ease: s2 = `easeOut`, times: c2 } = {}, l2 = void 0) {
  let u2 = { [t2]: n2 };
  c2 && (u2.offset = c2);
  let d2 = Wr(s2, i2);
  Array.isArray(d2) && (u2.easing = d2);
  let f2 = { delay: r2, duration: i2, easing: Array.isArray(d2) ? `linear` : d2, fill: `both`, iterations: a2 + 1, direction: o2 === `reverse` ? `alternate` : `normal` };
  return l2 && (f2.pseudoElement = l2), e2.animate(u2, f2);
}
function Kr(e2) {
  return typeof e2 == `function` && `applyToOptions` in e2;
}
function qr({ type: e2, ...t2 }) {
  return Kr(e2) && Vr() ? e2.applyToOptions(t2) : (t2.duration ??= 300, t2.ease ??= `easeOut`, t2);
}
var Jr = class extends ar {
  constructor(e2) {
    if (super(), this.finishedTime = null, this.isStopped = false, this.manualStartTime = null, !e2) return;
    let { element: t2, name: n2, keyframes: r2, pseudoElement: i2, allowFlatten: a2 = false, finalKeyframe: o2, onComplete: s2 } = e2;
    this.isPseudoElement = !!i2, this.allowFlatten = a2, this.options = e2, e2.type;
    let c2 = qr(e2);
    this.animation = Gr(t2, n2, r2, c2, i2), c2.autoplay === false && this.animation.pause(), this.animation.onfinish = () => {
      if (this.finishedTime = this.time, !i2) {
        let e3 = nr(r2, this.options, o2, this.speed);
        this.updateMotionValue && this.updateMotionValue(e3), Lr(t2, n2, e3), this.animation.cancel();
      }
      s2?.(), this.notifyFinished();
    };
  }
  play() {
    this.isStopped || (this.manualStartTime = null, this.animation.play(), this.state === `finished` && this.updateFinished());
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.finish?.();
  }
  cancel() {
    try {
      this.animation.cancel();
    } catch {
    }
  }
  stop() {
    if (this.isStopped) return;
    this.isStopped = true;
    let { state: e2 } = this;
    e2 === `idle` || e2 === `finished` || (this.updateMotionValue ? this.updateMotionValue() : this.commitStyles(), this.isPseudoElement || this.cancel());
  }
  commitStyles() {
    let e2 = this.options?.element;
    !this.isPseudoElement && e2?.isConnected && this.animation.commitStyles?.();
  }
  get duration() {
    let e2 = this.animation.effect?.getComputedTiming?.().duration || 0;
    return We(Number(e2));
  }
  get iterationDuration() {
    let { delay: e2 = 0 } = this.options || {};
    return this.duration + We(e2);
  }
  get time() {
    return We(Number(this.animation.currentTime) || 0);
  }
  set time(e2) {
    let t2 = this.finishedTime !== null;
    this.manualStartTime = null, this.finishedTime = null, this.animation.currentTime = Ue(e2), t2 && this.animation.pause();
  }
  get speed() {
    return this.animation.playbackRate;
  }
  set speed(e2) {
    e2 < 0 && (this.finishedTime = null), this.animation.playbackRate = e2;
  }
  get state() {
    return this.finishedTime === null ? this.animation.playState : `finished`;
  }
  get startTime() {
    return this.manualStartTime ?? Number(this.animation.startTime);
  }
  set startTime(e2) {
    this.manualStartTime = this.animation.startTime = e2;
  }
  attachTimeline({ timeline: e2, rangeStart: t2, rangeEnd: n2, observe: r2 }) {
    return this.allowFlatten && this.animation.effect?.updateTiming({ easing: `linear` }), this.animation.onfinish = null, e2 && Br() ? (this.animation.timeline = e2, t2 && (this.animation.rangeStart = t2), n2 && (this.animation.rangeEnd = n2), k) : r2(this);
  }
}, Yr = { anticipate: nt, backInOut: tt, circInOut: at };
function Xr(e2) {
  return e2 in Yr;
}
function Zr(e2) {
  typeof e2.ease == `string` && Xr(e2.ease) && (e2.ease = Yr[e2.ease]);
}
var Qr = 10, $r = class extends Jr {
  constructor(e2) {
    Zr(e2), ir(e2), super(e2), e2.startTime !== void 0 && e2.autoplay !== false && (this.startTime = e2.startTime), this.options = e2;
  }
  updateMotionValue(e2) {
    let { motionValue: t2, onUpdate: n2, onComplete: r2, element: i2, ...a2 } = this.options;
    if (!t2) return;
    if (e2 !== void 0) {
      t2.set(e2);
      return;
    }
    let o2 = new sr({ ...a2, autoplay: false }), s2 = Math.max(Qr, St.now() - this.startTime), c2 = Pe(0, Qr, s2 - Qr), l2 = o2.sample(s2).value, { name: u2 } = this.options;
    i2 && u2 && Lr(i2, u2, l2), t2.setWithVelocity(o2.sample(Math.max(0, s2 - c2)).value, l2, c2), o2.stop();
  }
}, ei = (e2, t2) => t2 !== `zIndex` && !!(typeof e2 == `number` || Array.isArray(e2) || typeof e2 == `string` && (fn.test(e2) || e2 === `0`) && !e2.startsWith(`url(`));
function ti(e2) {
  let t2 = e2[0];
  if (e2.length === 1) return true;
  for (let n2 = 0; n2 < e2.length; n2++) if (e2[n2] !== t2) return true;
}
function ni(e2, t2, n2, r2) {
  let i2 = e2[0];
  if (i2 === null) return false;
  if (t2 === `display` || t2 === `visibility`) return true;
  let a2 = e2[e2.length - 1], o2 = ei(i2, t2), s2 = ei(a2, t2);
  return `${t2}${i2}${a2}${o2 ? a2 : i2}`, !o2 || !s2 ? false : ti(e2) || (n2 === `spring` || Kr(n2)) && r2;
}
function ri(e2) {
  e2.duration = 0, e2.type = `keyframes`;
}
var ii = /* @__PURE__ */ new Set([`opacity`, `clipPath`, `filter`, `transform`]), ai = /^(?:oklch|oklab|lab|lch|color|color-mix|light-dark)\(/;
function oi(e2) {
  for (let t2 = 0; t2 < e2.length; t2++) if (typeof e2[t2] == `string` && ai.test(e2[t2])) return true;
  return false;
}
var si = /* @__PURE__ */ new Set([`color`, `backgroundColor`, `outlineColor`, `fill`, `stroke`, `borderColor`, `borderTopColor`, `borderRightColor`, `borderBottomColor`, `borderLeftColor`]), ci = ze(() => Object.hasOwnProperty.call(Element.prototype, `animate`));
function li(e2) {
  let { motionValue: t2, name: n2, repeatDelay: r2, repeatType: i2, damping: a2, type: o2, keyframes: s2 } = e2;
  if (!(t2?.owner?.current instanceof HTMLElement)) return false;
  let { onUpdate: c2, transformTemplate: l2 } = t2.owner.getProps();
  return ci() && n2 && (ii.has(n2) || si.has(n2) && oi(s2)) && (n2 !== `transform` || !l2) && !c2 && !r2 && i2 !== `mirror` && a2 !== 0 && o2 !== `inertia`;
}
var ui = 40, di = class extends ar {
  constructor({ autoplay: e2 = true, delay: t2 = 0, type: n2 = `keyframes`, repeat: r2 = 0, repeatDelay: i2 = 0, repeatType: a2 = `loop`, keyframes: o2, name: s2, motionValue: c2, element: l2, ...u2 }) {
    super(), this.stop = () => {
      this._animation && (this._animation.stop(), this.stopTimeline?.()), this.keyframeResolver?.cancel();
    }, this.createdAt = St.now();
    let d2 = { autoplay: e2, delay: t2, type: n2, repeat: r2, repeatDelay: i2, repeatType: a2, name: s2, motionValue: c2, element: l2, ...u2 }, f2 = l2?.KeyframeResolver || Fr;
    this.keyframeResolver = new f2(o2, (e3, t3, n3) => this.onKeyframesResolved(e3, t3, d2, !n3), s2, c2, l2), this.keyframeResolver?.scheduleResolve();
  }
  onKeyframesResolved(e2, t2, n2, r2) {
    this.keyframeResolver = void 0;
    let { name: i2, type: a2, velocity: o2, delay: s2, isHandoff: c2, onUpdate: l2 } = n2;
    this.resolvedAt = St.now();
    let u2 = true;
    ni(e2, i2, a2, o2) || (u2 = false, (Fe.instantAnimations || !s2) && l2?.(nr(e2, n2, t2)), e2[0] = e2[e2.length - 1], ri(n2), n2.repeat = 0);
    let d2 = { startTime: r2 ? this.resolvedAt && this.resolvedAt - this.createdAt > ui ? this.resolvedAt : this.createdAt : void 0, finalKeyframe: t2, ...n2, keyframes: e2 }, f2 = u2 && !c2 && li(d2), p2 = d2.motionValue?.owner?.current, m2;
    if (f2) try {
      m2 = new $r({ ...d2, element: p2 });
    } catch {
      m2 = new sr(d2);
    }
    else m2 = new sr(d2);
    m2.finished.then(() => {
      this.notifyFinished();
    }).catch(k), this.pendingTimeline &&= (this.stopTimeline = m2.attachTimeline(this.pendingTimeline), void 0), this._animation = m2;
  }
  get finished() {
    return this._animation ? this.animation.finished : this._finished;
  }
  then(e2, t2) {
    return this.finished.finally(e2).then(() => {
    });
  }
  get animation() {
    return this._animation || (this.keyframeResolver?.resume(), Pr()), this._animation;
  }
  get duration() {
    return this.animation.duration;
  }
  get iterationDuration() {
    return this.animation.iterationDuration;
  }
  get time() {
    return this.animation.time;
  }
  set time(e2) {
    this.animation.time = e2;
  }
  get speed() {
    return this.animation.speed;
  }
  get state() {
    return this.animation.state;
  }
  set speed(e2) {
    this.animation.speed = e2;
  }
  get startTime() {
    return this.animation.startTime;
  }
  attachTimeline(e2) {
    return this._animation ? this.stopTimeline = this.animation.attachTimeline(e2) : this.pendingTimeline = e2, () => this.stop();
  }
  play() {
    this.animation.play();
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.complete();
  }
  cancel() {
    this._animation && this.animation.cancel(), this.keyframeResolver?.cancel();
  }
};
function fi(e2, t2, n2, r2 = 0, i2 = 1) {
  let a2 = Array.from(e2).sort((e3, t3) => e3.sortNodePosition(t3)).indexOf(t2), o2 = e2.size, s2 = (o2 - 1) * r2;
  return typeof n2 == `function` ? n2(a2, o2) : i2 === 1 ? a2 * r2 : s2 - a2 * r2;
}
var pi = 30, mi = (e2) => !isNaN(parseFloat(e2)), hi = { current: void 0 }, gi = class {
  constructor(e2, t2 = {}) {
    this.canTrackVelocity = null, this.events = {}, this.updateAndNotify = (e3) => {
      let t3 = St.now();
      if (this.updatedAt !== t3 && this.setPrevFrameValue(), this.prev = this.current, this.setCurrent(e3), this.current !== this.prev && (this.events.change?.notify(this.current), this.dependents)) for (let e4 of this.dependents) e4.dirty();
    }, this.hasAnimated = false, this.setCurrent(e2), this.owner = t2.owner;
  }
  setCurrent(e2) {
    this.current = e2, this.updatedAt = St.now(), this.canTrackVelocity === null && e2 !== void 0 && (this.canTrackVelocity = mi(this.current));
  }
  setPrevFrameValue(e2 = this.current) {
    this.prevFrameValue = e2, this.prevUpdatedAt = this.updatedAt;
  }
  onChange(e2) {
    return this.on(`change`, e2);
  }
  on(e2, t2) {
    this.events[e2] || (this.events[e2] = new He());
    let n2 = this.events[e2].add(t2);
    return e2 === `change` ? () => {
      n2(), A.read(() => {
        this.events.change.getSize() || this.stop();
      });
    } : n2;
  }
  clearListeners() {
    for (let e2 in this.events) this.events[e2].clear();
  }
  attach(e2, t2) {
    this.passiveEffect = e2, this.stopPassiveEffect = t2;
  }
  set(e2) {
    this.passiveEffect ? this.passiveEffect(e2, this.updateAndNotify) : this.updateAndNotify(e2);
  }
  setWithVelocity(e2, t2, n2) {
    this.set(t2), this.prev = void 0, this.prevFrameValue = e2, this.prevUpdatedAt = this.updatedAt - n2;
  }
  jump(e2, t2 = true) {
    this.updateAndNotify(e2), this.prev = e2, this.prevUpdatedAt = this.prevFrameValue = void 0, t2 && this.stop(), this.stopPassiveEffect && this.stopPassiveEffect();
  }
  dirty() {
    this.events.change?.notify(this.current);
  }
  addDependent(e2) {
    this.dependents ||= /* @__PURE__ */ new Set(), this.dependents.add(e2);
  }
  removeDependent(e2) {
    this.dependents && this.dependents.delete(e2);
  }
  get() {
    return hi.current && hi.current.push(this), this.current;
  }
  getPrevious() {
    return this.prev;
  }
  getVelocity() {
    let e2 = St.now();
    if (!this.canTrackVelocity || this.prevFrameValue === void 0 || e2 - this.updatedAt > pi) return 0;
    let t2 = Math.min(this.updatedAt - this.prevUpdatedAt, pi);
    return Ge(parseFloat(this.current) - parseFloat(this.prevFrameValue), t2);
  }
  start(e2) {
    return this.stop(), new Promise((t2) => {
      this.hasAnimated = true, this.animation = e2(t2), this.events.animationStart && this.events.animationStart.notify();
    }).then(() => {
      this.events.animationComplete && this.events.animationComplete.notify(), this.clearAnimation();
    });
  }
  stop() {
    this.animation && (this.animation.stop(), this.events.animationCancel && this.events.animationCancel.notify()), this.clearAnimation();
  }
  isAnimating() {
    return !!this.animation;
  }
  clearAnimation() {
    delete this.animation;
  }
  destroy() {
    this.dependents?.clear(), this.events.destroy?.notify(), this.clearListeners(), this.stop(), this.stopPassiveEffect && this.stopPassiveEffect();
  }
};
function _i(e2, t2) {
  return new gi(e2, t2);
}
function vi(e2, t2) {
  if (e2?.inherit && t2) {
    let { inherit: n2, ...r2 } = e2;
    return { ...t2, ...r2 };
  }
  return e2;
}
function yi(e2, t2) {
  let n2 = e2?.[t2] ?? e2?.default ?? e2;
  return n2 === e2 ? n2 : vi(n2, e2);
}
var bi = { type: `spring`, stiffness: 500, damping: 25, restSpeed: 10 }, xi = (e2) => ({ type: `spring`, stiffness: 550, damping: e2 === 0 ? 2 * Math.sqrt(550) : 30, restSpeed: 10 }), Si = { type: `keyframes`, duration: 0.8 }, Ci = { type: `keyframes`, ease: [0.25, 0.1, 0.35, 1], duration: 0.3 }, wi = (e2, { keyframes: t2 }) => t2.length > 2 ? Si : Sr.has(e2) ? e2.startsWith(`scale`) ? xi(t2[1]) : bi : Ci, Ti = /* @__PURE__ */ new Set([`when`, `delay`, `delayChildren`, `staggerChildren`, `staggerDirection`, `repeat`, `repeatType`, `repeatDelay`, `from`, `elapsed`]);
function Ei(e2) {
  for (let t2 in e2) if (!Ti.has(t2)) return true;
  return false;
}
var Di = (e2, t2, n2, r2 = {}, i2, a2) => (o2) => {
  let s2 = yi(r2, e2) || {}, c2 = s2.delay || r2.delay || 0, { elapsed: l2 = 0 } = r2;
  l2 -= Ue(c2);
  let u2 = { keyframes: Array.isArray(n2) ? n2 : [null, n2], ease: `easeOut`, velocity: t2.getVelocity(), ...s2, delay: -l2, onUpdate: (e3) => {
    t2.set(e3), s2.onUpdate && s2.onUpdate(e3);
  }, onComplete: () => {
    o2(), s2.onComplete && s2.onComplete();
  }, name: e2, motionValue: t2, element: a2 ? void 0 : i2 };
  Ei(s2) || Object.assign(u2, wi(e2, u2)), u2.duration &&= Ue(u2.duration), u2.repeatDelay &&= Ue(u2.repeatDelay), u2.from !== void 0 && (u2.keyframes[0] = u2.from);
  let d2 = false;
  if ((u2.type === false || u2.duration === 0 && !u2.repeatDelay) && (ri(u2), u2.delay === 0 && (d2 = true)), (Fe.instantAnimations || Fe.skipAnimations || i2?.shouldSkipAnimations || s2.skipAnimations) && (d2 = true, ri(u2), u2.delay = 0), u2.allowFlatten = !s2.type && !s2.ease, d2 && !a2 && t2.get() !== void 0) {
    let e3 = nr(u2.keyframes, s2);
    if (e3 !== void 0) {
      A.update(() => {
        u2.onUpdate(e3), u2.onComplete();
      });
      return;
    }
  }
  return s2.isSync ? new sr(u2) : new di(u2);
}, Oi = /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;
function ki(e2) {
  let t2 = Oi.exec(e2);
  if (!t2) return [,];
  let [, n2, r2, i2] = t2;
  return [`--${n2 ?? r2}`, i2];
}
function Ai(e2, t2, n2 = 1) {
  `${e2}`;
  let [r2, i2] = ki(e2);
  if (!r2) return;
  let a2 = window.getComputedStyle(t2).getPropertyValue(r2);
  if (a2) {
    let e3 = a2.trim();
    return Ie(e3) ? parseFloat(e3) : e3;
  }
  return Et(i2) ? Ai(i2, t2, n2 + 1) : i2;
}
function ji(e2) {
  let t2 = [{}, {}];
  return e2?.values.forEach((e3, n2) => {
    t2[0][n2] = e3.get(), t2[1][n2] = e3.getVelocity();
  }), t2;
}
function Mi(e2, t2, n2, r2) {
  if (typeof t2 == `function`) {
    let [i2, a2] = ji(r2);
    t2 = t2(n2 === void 0 ? e2.custom : n2, i2, a2);
  }
  if (typeof t2 == `string` && (t2 = e2.variants && e2.variants[t2]), typeof t2 == `function`) {
    let [i2, a2] = ji(r2);
    t2 = t2(n2 === void 0 ? e2.custom : n2, i2, a2);
  }
  return t2;
}
function I(e2, t2, n2) {
  let r2 = e2.getProps();
  return Mi(r2, t2, n2 === void 0 ? r2.custom : n2, e2);
}
var Ni = /* @__PURE__ */ new Set([`width`, `height`, `top`, `left`, `right`, `bottom`, ...xr]), Pi = (e2) => Array.isArray(e2);
function Fi(e2, t2, n2) {
  e2.hasValue(t2) ? e2.getValue(t2).set(n2) : e2.addValue(t2, _i(n2));
}
function Ii(e2) {
  return Pi(e2) ? e2[e2.length - 1] || 0 : e2;
}
function Li(e2, t2) {
  let { transitionEnd: n2 = {}, transition: r2 = {}, ...i2 } = I(e2, t2) || {};
  i2 = { ...i2, ...n2 };
  for (let t3 in i2) Fi(e2, t3, Ii(i2[t3]));
}
var Ri = (e2) => !!(e2 && e2.getVelocity);
function zi(e2) {
  return !!(Ri(e2) && e2.add);
}
function Bi(e2, t2) {
  let n2 = e2.getValue(`willChange`);
  if (zi(n2)) return n2.add(t2);
  if (!n2 && Fe.WillChange) {
    let n3 = new Fe.WillChange(`auto`);
    e2.addValue(`willChange`, n3), n3.add(t2);
  }
}
function Vi(e2) {
  return e2.replace(/([A-Z])/g, (e3) => `-${e3.toLowerCase()}`);
}
var Hi = `data-` + Vi(`framerAppearId`);
function Ui(e2) {
  return e2.props[Hi];
}
function Wi({ protectedKeys: e2, needsAnimating: t2 }, n2) {
  let r2 = e2.hasOwnProperty(n2) && t2[n2] !== true;
  return t2[n2] = false, r2;
}
function Gi(e2, t2, { delay: n2 = 0, transitionOverride: r2, type: i2 } = {}) {
  let { transition: a2, transitionEnd: o2, ...s2 } = t2, c2 = e2.getDefaultTransition();
  a2 = a2 ? vi(a2, c2) : c2;
  let l2 = a2?.reduceMotion, u2 = a2?.skipAnimations;
  r2 && (a2 = r2);
  let d2 = [], f2 = i2 && e2.animationState && e2.animationState.getState()[i2], p2 = a2?.path;
  p2 && p2.animateVisualElement(e2, s2, a2, n2, d2);
  for (let t3 in s2) {
    let r3 = e2.getValue(t3, e2.latestValues[t3] ?? null), i3 = s2[t3];
    if (i3 === void 0 || f2 && Wi(f2, t3)) continue;
    let o3 = { delay: n2, ...yi(a2 || {}, t3) };
    u2 && (o3.skipAnimations = true);
    let c3 = r3.get();
    if (c3 !== void 0 && !r3.isAnimating() && !Array.isArray(i3) && i3 === c3 && !o3.velocity) {
      A.update(() => r3.set(i3));
      continue;
    }
    let p3 = false;
    if (window.MotionHandoffAnimation) {
      let n3 = Ui(e2);
      if (n3) {
        let e3 = window.MotionHandoffAnimation(n3, t3, A);
        e3 !== null && (o3.startTime = e3, p3 = true);
      }
    }
    Bi(e2, t3);
    let m2 = l2 ?? e2.shouldReduceMotion;
    r3.start(Di(t3, r3, i3, m2 && Ni.has(t3) ? { type: false } : o3, e2, p3));
    let h2 = r3.animation;
    h2 && d2.push(h2);
  }
  if (o2) {
    let t3 = () => A.update(() => {
      o2 && Li(e2, o2);
    });
    d2.length ? Promise.all(d2).then(t3) : t3();
  }
  return d2;
}
function Ki(e2, t2, n2 = {}) {
  let r2 = I(e2, t2, n2.type === `exit` ? e2.presenceContext?.custom : void 0), { transition: i2 = e2.getDefaultTransition() || {} } = r2 || {};
  n2.transitionOverride && (i2 = n2.transitionOverride);
  let a2 = r2 ? () => Promise.all(Gi(e2, r2, n2)) : () => Promise.resolve(), o2 = e2.variantChildren && e2.variantChildren.size ? (r3 = 0) => {
    let { delayChildren: a3 = 0, staggerChildren: o3, staggerDirection: s3 } = i2;
    return qi(e2, t2, r3, a3, o3, s3, n2);
  } : () => Promise.resolve(), { when: s2 } = i2;
  if (s2) {
    let [e3, t3] = s2 === `beforeChildren` ? [a2, o2] : [o2, a2];
    return e3().then(() => t3());
  } else return Promise.all([a2(), o2(n2.delay)]);
}
function qi(e2, t2, n2 = 0, r2 = 0, i2 = 0, a2 = 1, o2) {
  let s2 = [];
  for (let c2 of e2.variantChildren) c2.notify(`AnimationStart`, t2), s2.push(Ki(c2, t2, { ...o2, delay: n2 + (typeof r2 == `function` ? 0 : r2) + fi(e2.variantChildren, c2, r2, i2, a2) }).then(() => c2.notify(`AnimationComplete`, t2)));
  return Promise.all(s2);
}
function Ji(e2, t2, n2 = {}) {
  e2.notify(`AnimationStart`, t2);
  let r2;
  if (Array.isArray(t2)) {
    let i2 = t2.map((t3) => Ki(e2, t3, n2));
    r2 = Promise.all(i2);
  } else if (typeof t2 == `string`) r2 = Ki(e2, t2, n2);
  else {
    let i2 = typeof t2 == `function` ? I(e2, t2, n2.custom) : t2;
    r2 = Promise.all(Gi(e2, i2, n2));
  }
  return r2.then(() => {
    e2.notify(`AnimationComplete`, t2);
  });
}
var Yi = { test: (e2) => e2 === `auto`, parse: (e2) => e2 }, Xi = (e2) => (t2) => t2.test(e2), Zi = [kt, M, Gt, Wt, qt, Kt, Yi], Qi = (e2) => Zi.find(Xi(e2));
function $i(e2) {
  return typeof e2 == `number` ? e2 === 0 : e2 === null || e2 === `none` || e2 === `0` || Re(e2);
}
var ea = /* @__PURE__ */ new Set([`brightness`, `contrast`, `saturate`, `opacity`]);
function ta(e2) {
  let [t2, n2] = e2.slice(0, -1).split(`(`);
  if (t2 === `drop-shadow`) return e2;
  let [r2] = n2.match(Nt) || [];
  if (!r2) return e2;
  let i2 = n2.replace(r2, ``), a2 = +!!ea.has(t2);
  return r2 !== n2 && (a2 *= 100), t2 + `(` + a2 + i2 + `)`;
}
var na = /\b([a-z-]*)\(.*?\)/gu, ra = { ...fn, getAnimatableNone: (e2) => {
  let t2 = e2.match(na);
  return t2 ? t2.map(ta).join(` `) : e2;
} }, ia = { ...fn, getAnimatableNone: (e2) => {
  let t2 = fn.parse(e2);
  return fn.createTransformer(e2)(t2.map((e3) => typeof e3 == `number` ? 0 : typeof e3 == `object` ? { ...e3, alpha: 1 } : e3));
} }, aa = { ...kt, transform: Math.round }, oa = { borderWidth: M, borderTopWidth: M, borderRightWidth: M, borderBottomWidth: M, borderLeftWidth: M, borderRadius: M, borderTopLeftRadius: M, borderTopRightRadius: M, borderBottomRightRadius: M, borderBottomLeftRadius: M, width: M, maxWidth: M, height: M, maxHeight: M, top: M, right: M, bottom: M, left: M, inset: M, insetBlock: M, insetBlockStart: M, insetBlockEnd: M, insetInline: M, insetInlineStart: M, insetInlineEnd: M, padding: M, paddingTop: M, paddingRight: M, paddingBottom: M, paddingLeft: M, paddingBlock: M, paddingBlockStart: M, paddingBlockEnd: M, paddingInline: M, paddingInlineStart: M, paddingInlineEnd: M, margin: M, marginTop: M, marginRight: M, marginBottom: M, marginLeft: M, marginBlock: M, marginBlockStart: M, marginBlockEnd: M, marginInline: M, marginInlineStart: M, marginInlineEnd: M, fontSize: M, backgroundPositionX: M, backgroundPositionY: M, rotate: Wt, pathRotation: Wt, rotateX: Wt, rotateY: Wt, rotateZ: Wt, scale: jt, scaleX: jt, scaleY: jt, scaleZ: jt, skew: Wt, skewX: Wt, skewY: Wt, distance: M, translateX: M, translateY: M, translateZ: M, x: M, y: M, z: M, perspective: M, transformPerspective: M, opacity: At, originX: Jt, originY: Jt, originZ: M, zIndex: aa, fillOpacity: At, strokeOpacity: At, numOctaves: aa }, sa = { ...oa, color: N, backgroundColor: N, outlineColor: N, fill: N, stroke: N, borderColor: N, borderTopColor: N, borderRightColor: N, borderBottomColor: N, borderLeftColor: N, filter: ra, WebkitFilter: ra, mask: ia, WebkitMask: ia }, ca = (e2) => sa[e2], la = /* @__PURE__ */ new Set([ra, ia]);
function ua(e2, t2) {
  let n2 = ca(e2);
  return la.has(n2) || (n2 = fn), n2.getAnimatableNone ? n2.getAnimatableNone(t2) : void 0;
}
var da = /* @__PURE__ */ new Set([`auto`, `none`, `0`]);
function fa(e2, t2, n2) {
  let r2 = 0, i2;
  for (; r2 < e2.length && !i2; ) {
    let t3 = e2[r2];
    typeof t3 == `string` && !da.has(t3) && an(t3).values.length && (i2 = e2[r2]), r2++;
  }
  if (i2 && n2) for (let r3 of t2) e2[r3] = ua(n2, i2);
}
var pa = class extends Fr {
  constructor(e2, t2, n2, r2, i2) {
    super(e2, t2, n2, r2, i2, true);
  }
  readKeyframes() {
    let { unresolvedKeyframes: e2, element: t2, name: n2 } = this;
    if (!t2 || !t2.current) return;
    super.readKeyframes();
    for (let n3 = 0; n3 < e2.length; n3++) {
      let r3 = e2[n3];
      if (typeof r3 == `string` && (r3 = r3.trim(), Et(r3))) {
        let i3 = Ai(r3, t2.current);
        i3 !== void 0 && (e2[n3] = i3), n3 === e2.length - 1 && (this.finalKeyframe = r3);
      }
    }
    if (this.resolveNoneKeyframes(), !Ni.has(n2) || e2.length !== 2) return;
    let [r2, i2] = e2, a2 = Qi(r2), o2 = Qi(i2);
    if (Ot(r2) !== Ot(i2) && Dr[n2]) {
      this.needsMeasurement = true;
      return;
    }
    if (a2 !== o2) if (Cr(a2) && Cr(o2)) for (let t3 = 0; t3 < e2.length; t3++) {
      let n3 = e2[t3];
      typeof n3 == `string` && (e2[t3] = parseFloat(n3));
    }
    else Dr[n2] && (this.needsMeasurement = true);
  }
  resolveNoneKeyframes() {
    let { unresolvedKeyframes: e2, name: t2 } = this, n2 = [];
    for (let t3 = 0; t3 < e2.length; t3++) (e2[t3] === null || $i(e2[t3])) && n2.push(t3);
    n2.length && fa(e2, n2, t2);
  }
  measureInitialState() {
    let { element: e2, unresolvedKeyframes: t2, name: n2 } = this;
    if (!e2 || !e2.current) return;
    n2 === `height` && (this.suspendedScrollY = window.pageYOffset), this.measuredOrigin = Dr[n2](e2.measureViewportBox(), window.getComputedStyle(e2.current)), t2[0] = this.measuredOrigin;
    let r2 = t2[t2.length - 1];
    r2 !== void 0 && e2.getValue(n2, r2).jump(r2, false);
  }
  measureEndState() {
    let { element: e2, name: t2, unresolvedKeyframes: n2 } = this;
    if (!e2 || !e2.current) return;
    let r2 = e2.getValue(t2);
    r2 && r2.jump(this.measuredOrigin, false);
    let i2 = n2.length - 1, a2 = n2[i2];
    n2[i2] = Dr[t2](e2.measureViewportBox(), window.getComputedStyle(e2.current)), a2 !== null && this.finalKeyframe === void 0 && (this.finalKeyframe = a2), this.removedTransforms?.length && this.removedTransforms.forEach(([t3, n3]) => {
      e2.getValue(t3).set(n3);
    }), this.resolveNoneKeyframes();
  }
}, ma = [`borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius`];
function ha(e2, t2, n2) {
  if (e2 == null) return [];
  if (e2 instanceof EventTarget) return [e2];
  if (typeof e2 == `string`) {
    let r2 = document;
    t2 && (r2 = t2.current);
    let i2 = n2?.[e2] ?? r2.querySelectorAll(e2);
    return i2 ? Array.from(i2) : [];
  }
  return Array.from(e2).filter((e3) => e3 != null);
}
var ga = (e2, t2) => t2 && typeof e2 == `number` ? t2.transform(e2) : e2;
function _a(e2) {
  return Le(e2) && `offsetHeight` in e2 && !(`ownerSVGElement` in e2);
}
var { schedule: va, cancel: ya } = _t(queueMicrotask, false), ba = { x: false, y: false };
function xa() {
  return ba.x || ba.y;
}
function Sa(e2) {
  return e2 === `x` || e2 === `y` ? ba[e2] ? null : (ba[e2] = true, () => {
    ba[e2] = false;
  }) : ba.x || ba.y ? null : (ba.x = ba.y = true, () => {
    ba.x = ba.y = false;
  });
}
function Ca(e2, t2) {
  let n2 = ha(e2), r2 = new AbortController();
  return [n2, { passive: true, ...t2, signal: r2.signal }, () => r2.abort()];
}
function wa(e2) {
  return !(e2.pointerType === `touch` || xa());
}
function Ta(e2, t2, n2 = {}) {
  let [r2, i2, a2] = Ca(e2, n2);
  return r2.forEach((e3) => {
    let n3 = false, r3 = false, a3, o2 = () => {
      e3.removeEventListener(`pointerleave`, u2);
    }, s2 = (e4) => {
      a3 &&= (a3(e4), void 0), o2();
    }, c2 = (e4) => {
      n3 = false, window.removeEventListener(`pointerup`, c2), window.removeEventListener(`pointercancel`, c2), r3 && (r3 = false, s2(e4));
    }, l2 = () => {
      n3 = true, window.addEventListener(`pointerup`, c2, i2), window.addEventListener(`pointercancel`, c2, i2);
    }, u2 = (e4) => {
      if (e4.pointerType !== `touch`) {
        if (n3) {
          r3 = true;
          return;
        }
        s2(e4);
      }
    };
    e3.addEventListener(`pointerenter`, (n4) => {
      if (!wa(n4)) return;
      r3 = false;
      let o3 = t2(e3, n4);
      typeof o3 == `function` && (a3 = o3, e3.addEventListener(`pointerleave`, u2, i2));
    }, i2), e3.addEventListener(`pointerdown`, l2, i2);
  }), a2;
}
var Ea = (e2, t2) => t2 ? e2 === t2 || Ea(e2, t2.parentElement) : false, Da = (e2) => e2.pointerType === `mouse` ? typeof e2.button != `number` || e2.button <= 0 : e2.isPrimary !== false, Oa = /* @__PURE__ */ new Set([`BUTTON`, `INPUT`, `SELECT`, `TEXTAREA`, `A`]);
function ka(e2) {
  return Oa.has(e2.tagName) || e2.isContentEditable === true;
}
var Aa = /* @__PURE__ */ new Set([`INPUT`, `SELECT`, `TEXTAREA`]);
function ja(e2) {
  return Aa.has(e2.tagName) || e2.isContentEditable === true;
}
var Ma = /* @__PURE__ */ new WeakSet();
function Na(e2) {
  return (t2) => {
    t2.key === `Enter` && e2(t2);
  };
}
function Pa(e2, t2) {
  e2.dispatchEvent(new PointerEvent(`pointer` + t2, { isPrimary: true, bubbles: true }));
}
var Fa = (e2, t2) => {
  let n2 = e2.currentTarget;
  if (!n2) return;
  let r2 = Na(() => {
    if (Ma.has(n2)) return;
    Pa(n2, `down`);
    let e3 = Na(() => {
      Pa(n2, `up`);
    });
    n2.addEventListener(`keyup`, e3, t2), n2.addEventListener(`blur`, () => Pa(n2, `cancel`), t2);
  });
  n2.addEventListener(`keydown`, r2, t2), n2.addEventListener(`blur`, () => n2.removeEventListener(`keydown`, r2), t2);
};
function Ia(e2) {
  return Da(e2) && !xa();
}
var La = /* @__PURE__ */ new WeakSet();
function Ra(e2, t2, n2 = {}) {
  let [r2, i2, a2] = Ca(e2, n2), o2 = (e3) => {
    let r3 = e3.currentTarget;
    if (!Ia(e3) || La.has(e3)) return;
    Ma.add(r3), n2.stopPropagation && La.add(e3);
    let a3 = t2(r3, e3), o3 = { ...i2, capture: true }, s2 = (e4, t3) => {
      window.removeEventListener(`pointerup`, c2, o3), window.removeEventListener(`pointercancel`, l2, o3), Ma.has(r3) && Ma.delete(r3), Ia(e4) && typeof a3 == `function` && a3(e4, { success: t3 });
    }, c2 = (e4) => {
      s2(e4, r3 === window || r3 === document || n2.useGlobalTarget || Ea(r3, e4.target));
    }, l2 = (e4) => {
      s2(e4, false);
    };
    window.addEventListener(`pointerup`, c2, o3), window.addEventListener(`pointercancel`, l2, o3);
  };
  return r2.forEach((e3) => {
    (n2.useGlobalTarget ? window : e3).addEventListener(`pointerdown`, o2, i2), _a(e3) && (e3.addEventListener(`focus`, (e4) => Fa(e4, i2)), !ka(e3) && !e3.hasAttribute(`tabindex`) && (e3.tabIndex = 0));
  }), a2;
}
function za(e2) {
  return Le(e2) && `ownerSVGElement` in e2;
}
var Ba = /* @__PURE__ */ new WeakMap(), Va, Ha = (e2, t2, n2) => (r2, i2) => i2 && i2[0] ? i2[0][e2 + `Size`] : za(r2) && `getBBox` in r2 ? r2.getBBox()[t2] : r2[n2], Ua = Ha(`inline`, `width`, `offsetWidth`), Wa = Ha(`block`, `height`, `offsetHeight`);
function Ga({ target: e2, borderBoxSize: t2 }) {
  Ba.get(e2)?.forEach((n2) => {
    n2(e2, { get width() {
      return Ua(e2, t2);
    }, get height() {
      return Wa(e2, t2);
    } });
  });
}
function Ka(e2) {
  e2.forEach(Ga);
}
function qa() {
  typeof ResizeObserver > `u` || (Va = new ResizeObserver(Ka));
}
function L(e2, t2) {
  Va || qa();
  let n2 = ha(e2);
  return n2.forEach((e3) => {
    let n3 = Ba.get(e3);
    n3 || (n3 = /* @__PURE__ */ new Set(), Ba.set(e3, n3)), n3.add(t2), Va?.observe(e3);
  }), () => {
    n2.forEach((e3) => {
      let n3 = Ba.get(e3);
      n3?.delete(t2), n3?.size || Va?.unobserve(e3);
    });
  };
}
var R = /* @__PURE__ */ new Set(), z;
function Ja() {
  z = () => {
    let e2 = { get width() {
      return window.innerWidth;
    }, get height() {
      return window.innerHeight;
    } };
    R.forEach((t2) => t2(e2));
  }, window.addEventListener(`resize`, z);
}
function Ya(e2) {
  return R.add(e2), z || Ja(), () => {
    R.delete(e2), !R.size && typeof z == `function` && (window.removeEventListener(`resize`, z), z = void 0);
  };
}
function Xa(e2, t2) {
  return typeof e2 == `function` ? Ya(e2) : L(e2, t2);
}
var Za = { value: null, addProjectionMetrics: null };
function Qa(e2) {
  return za(e2) && e2.tagName === `svg`;
}
var $a = [...Zi, N, fn], eo = (e2) => $a.find(Xi(e2)), to = () => ({ translate: 0, scale: 1, origin: 0, originPoint: 0 }), no = () => ({ x: to(), y: to() }), ro = () => ({ min: 0, max: 0 }), io = () => ({ x: ro(), y: ro() }), ao = /* @__PURE__ */ new WeakMap();
function oo(e2) {
  return typeof e2 == `object` && !!e2 && typeof e2.start == `function`;
}
function so(e2) {
  return typeof e2 == `string` || Array.isArray(e2);
}
var co = [`animate`, `whileInView`, `whileFocus`, `whileHover`, `whileTap`, `whileDrag`, `exit`], lo = [`initial`, ...co];
function uo(e2) {
  return oo(e2.animate) || lo.some((t2) => so(e2[t2]));
}
function fo(e2) {
  return !!(uo(e2) || e2.variants);
}
function po(e2, t2, n2) {
  for (let r2 in t2) {
    let i2 = t2[r2], a2 = n2[r2];
    if (Ri(i2)) e2.addValue(r2, i2);
    else if (Ri(a2)) e2.addValue(r2, _i(i2, { owner: e2 }));
    else if (a2 !== i2) if (e2.hasValue(r2)) {
      let t3 = e2.getValue(r2);
      t3.liveStyle === true ? t3.jump(i2) : t3.hasAnimated || t3.set(i2);
    } else {
      let t3 = e2.getStaticValue(r2);
      e2.addValue(r2, _i(t3 === void 0 ? i2 : t3, { owner: e2 }));
    }
  }
  for (let r2 in n2) t2[r2] === void 0 && e2.removeValue(r2);
  return t2;
}
var mo = { current: null }, ho = { current: false }, go = typeof window < `u`;
function _o() {
  if (ho.current = true, go) if (window.matchMedia) {
    let e2 = window.matchMedia(`(prefers-reduced-motion)`), t2 = () => mo.current = e2.matches;
    e2.addEventListener(`change`, t2), t2();
  } else mo.current = false;
}
var vo = [`AnimationStart`, `AnimationComplete`, `Update`, `BeforeLayoutMeasure`, `LayoutMeasure`, `LayoutAnimationStart`, `LayoutAnimationComplete`], yo = {};
function bo(e2) {
  yo = e2;
}
function xo() {
  return yo;
}
var So = class {
  scrapeMotionValuesFromProps(e2, t2, n2) {
    return {};
  }
  constructor({ parent: e2, props: t2, presenceContext: n2, reducedMotionConfig: r2, skipAnimations: i2, blockInitialAnimation: a2, visualState: o2 }, s2 = {}) {
    this.current = null, this.children = /* @__PURE__ */ new Set(), this.isVariantNode = false, this.isControllingVariants = false, this.shouldReduceMotion = null, this.shouldSkipAnimations = false, this.values = /* @__PURE__ */ new Map(), this.KeyframeResolver = Fr, this.features = {}, this.valueSubscriptions = /* @__PURE__ */ new Map(), this.prevMotionValues = {}, this.hasBeenMounted = false, this.events = {}, this.propEventSubscriptions = {}, this.notifyUpdate = () => this.notify(`Update`, this.latestValues), this.render = () => {
      this.current && (this.triggerBuild(), this.renderInstance(this.current, this.renderState, this.props.style, this.projection));
    }, this.renderScheduledAt = 0, this.scheduleRender = () => {
      let e3 = St.now();
      this.renderScheduledAt < e3 && (this.renderScheduledAt = e3, A.render(this.render, false, true));
    };
    let { latestValues: c2, renderState: l2 } = o2;
    this.latestValues = c2, this.baseTarget = { ...c2 }, this.initialValues = t2.initial ? { ...c2 } : {}, this.renderState = l2, this.parent = e2, this.props = t2, this.presenceContext = n2, this.depth = e2 ? e2.depth + 1 : 0, this.reducedMotionConfig = r2, this.skipAnimationsConfig = i2, this.options = s2, this.blockInitialAnimation = !!a2, this.isControllingVariants = uo(t2), this.isVariantNode = fo(t2), this.isVariantNode && (this.variantChildren = /* @__PURE__ */ new Set()), this.manuallyAnimateOnMount = !!(e2 && e2.current);
    let { willChange: u2, ...d2 } = this.scrapeMotionValuesFromProps(t2, {}, this);
    for (let e3 in d2) {
      let t3 = d2[e3];
      c2[e3] !== void 0 && Ri(t3) && t3.set(c2[e3]);
    }
  }
  mount(e2) {
    if (this.hasBeenMounted) for (let e3 in this.initialValues) this.values.get(e3)?.jump(this.initialValues[e3]), this.latestValues[e3] = this.initialValues[e3];
    this.current = e2, ao.set(e2, this), this.projection && !this.projection.instance && this.projection.mount(e2), this.parent && this.isVariantNode && !this.isControllingVariants && (this.removeFromVariantTree = this.parent.addVariantChild(this)), this.values.forEach((e3, t2) => this.bindToMotionValue(t2, e3)), this.reducedMotionConfig === `never` ? this.shouldReduceMotion = false : this.reducedMotionConfig === `always` ? this.shouldReduceMotion = true : (ho.current || _o(), this.shouldReduceMotion = mo.current), this.shouldSkipAnimations = this.skipAnimationsConfig ?? false, this.parent?.addChild(this), this.update(this.props, this.presenceContext), this.hasBeenMounted = true;
  }
  unmount() {
    this.projection && this.projection.unmount(), vt(this.notifyUpdate), vt(this.render), this.valueSubscriptions.forEach((e2) => e2()), this.valueSubscriptions.clear(), this.removeFromVariantTree && this.removeFromVariantTree(), this.parent?.removeChild(this);
    for (let e2 in this.events) this.events[e2].clear();
    for (let e2 in this.features) {
      let t2 = this.features[e2];
      t2 && (t2.unmount(), t2.isMounted = false);
    }
    this.current = null;
  }
  addChild(e2) {
    this.children.add(e2), this.enteringChildren ??= /* @__PURE__ */ new Set(), this.enteringChildren.add(e2);
  }
  removeChild(e2) {
    this.children.delete(e2), this.enteringChildren && this.enteringChildren.delete(e2);
  }
  bindToMotionValue(e2, t2) {
    if (this.valueSubscriptions.has(e2) && this.valueSubscriptions.get(e2)(), t2.accelerate && ii.has(e2) && this.current instanceof HTMLElement) {
      let { factory: n3, keyframes: r3, times: i3, ease: a2, duration: o2 } = t2.accelerate, s2 = new Jr({ element: this.current, name: e2, keyframes: r3, times: i3, ease: a2, duration: Ue(o2) }), c2 = n3(s2);
      this.valueSubscriptions.set(e2, () => {
        c2(), s2.cancel();
      });
      return;
    }
    let n2 = Sr.has(e2);
    n2 && this.onBindTransform && this.onBindTransform();
    let r2 = t2.on(`change`, (t3) => {
      this.latestValues[e2] = t3, this.props.onUpdate && A.preRender(this.notifyUpdate), n2 && this.projection && (this.projection.isTransformDirty = true), this.scheduleRender();
    }), i2;
    typeof window < `u` && window.MotionCheckAppearSync && (i2 = window.MotionCheckAppearSync(this, e2, t2)), this.valueSubscriptions.set(e2, () => {
      r2(), i2 && i2();
    });
  }
  sortNodePosition(e2) {
    return !this.current || !this.sortInstanceNodePosition || this.type !== e2.type ? 0 : this.sortInstanceNodePosition(this.current, e2.current);
  }
  updateFeatures() {
    let e2 = `animation`;
    for (e2 in yo) {
      let t2 = yo[e2];
      if (!t2) continue;
      let { isEnabled: n2, Feature: r2 } = t2;
      if (!this.features[e2] && r2 && n2(this.props) && (this.features[e2] = new r2(this)), this.features[e2]) {
        let t3 = this.features[e2];
        t3.isMounted ? t3.update() : (t3.mount(), t3.isMounted = true);
      }
    }
  }
  triggerBuild() {
    this.build(this.renderState, this.latestValues, this.props);
  }
  measureViewportBox() {
    return this.current ? this.measureInstanceViewportBox(this.current, this.props) : io();
  }
  getStaticValue(e2) {
    return this.latestValues[e2];
  }
  setStaticValue(e2, t2) {
    this.latestValues[e2] = t2;
  }
  update(e2, t2) {
    (e2.transformTemplate || this.props.transformTemplate) && this.scheduleRender(), this.prevProps = this.props, this.props = e2, this.prevPresenceContext = this.presenceContext, this.presenceContext = t2;
    for (let t3 = 0; t3 < vo.length; t3++) {
      let n2 = vo[t3];
      this.propEventSubscriptions[n2] && (this.propEventSubscriptions[n2](), delete this.propEventSubscriptions[n2]);
      let r2 = e2[`on` + n2];
      r2 && (this.propEventSubscriptions[n2] = this.on(n2, r2));
    }
    this.prevMotionValues = po(this, this.scrapeMotionValuesFromProps(e2, this.prevProps || {}, this), this.prevMotionValues), this.handleChildMotionValue && this.handleChildMotionValue();
  }
  getProps() {
    return this.props;
  }
  getVariant(e2) {
    return this.props.variants ? this.props.variants[e2] : void 0;
  }
  getDefaultTransition() {
    return this.props.transition;
  }
  getTransformPagePoint() {
    return this.props.transformPagePoint;
  }
  getClosestVariantNode() {
    return this.isVariantNode ? this : this.parent ? this.parent.getClosestVariantNode() : void 0;
  }
  addVariantChild(e2) {
    let t2 = this.getClosestVariantNode();
    if (t2) return t2.variantChildren && t2.variantChildren.add(e2), () => t2.variantChildren.delete(e2);
  }
  addValue(e2, t2) {
    let n2 = this.values.get(e2);
    t2 !== n2 && (n2 && this.removeValue(e2), this.bindToMotionValue(e2, t2), this.values.set(e2, t2), this.latestValues[e2] = t2.get());
  }
  removeValue(e2) {
    this.values.delete(e2);
    let t2 = this.valueSubscriptions.get(e2);
    t2 && (t2(), this.valueSubscriptions.delete(e2)), delete this.latestValues[e2], this.removeValueFromRenderState(e2, this.renderState);
  }
  hasValue(e2) {
    return this.values.has(e2);
  }
  getValue(e2, t2) {
    if (this.props.values && this.props.values[e2]) return this.props.values[e2];
    let n2 = this.values.get(e2);
    return n2 === void 0 && t2 !== void 0 && (n2 = _i(t2 === null ? void 0 : t2, { owner: this }), this.addValue(e2, n2)), n2;
  }
  readValue(e2, t2) {
    let n2 = this.latestValues[e2] !== void 0 || !this.current ? this.latestValues[e2] : this.getBaseTargetFromProps(this.props, e2) ?? this.readValueFromInstance(this.current, e2, this.options);
    return n2 != null && (typeof n2 == `string` && (Ie(n2) || Re(n2)) ? n2 = parseFloat(n2) : !eo(n2) && fn.test(t2) && (n2 = ua(e2, t2)), this.setBaseTarget(e2, Ri(n2) ? n2.get() : n2)), Ri(n2) ? n2.get() : n2;
  }
  setBaseTarget(e2, t2) {
    this.baseTarget[e2] = t2;
  }
  getBaseTarget(e2) {
    let { initial: t2 } = this.props, n2;
    if (typeof t2 == `string` || typeof t2 == `object`) {
      let r3 = Mi(this.props, t2, this.presenceContext?.custom);
      r3 && (n2 = r3[e2]);
    }
    if (t2 && n2 !== void 0) return n2;
    let r2 = this.getBaseTargetFromProps(this.props, e2);
    return r2 !== void 0 && !Ri(r2) ? r2 : this.initialValues[e2] !== void 0 && n2 === void 0 ? void 0 : this.baseTarget[e2];
  }
  on(e2, t2) {
    return this.events[e2] || (this.events[e2] = new He()), this.events[e2].add(t2);
  }
  notify(e2, ...t2) {
    this.events[e2] && this.events[e2].notify(...t2);
  }
  scheduleRenderMicrotask() {
    va.render(this.render);
  }
}, Co = class extends So {
  constructor() {
    super(...arguments), this.KeyframeResolver = pa;
  }
  sortInstanceNodePosition(e2, t2) {
    return e2.compareDocumentPosition(t2) & 2 ? 1 : -1;
  }
  getBaseTargetFromProps(e2, t2) {
    let n2 = e2.style;
    return n2 ? n2[t2] : void 0;
  }
  removeValueFromRenderState(e2, { vars: t2, style: n2 }) {
    delete t2[e2], delete n2[e2];
  }
  handleChildMotionValue() {
    this.childSubscription && (this.childSubscription(), delete this.childSubscription);
    let { children: e2 } = this.props;
    Ri(e2) && (this.childSubscription = e2.on(`change`, (e3) => {
      this.current && (this.current.textContent = `${e3}`);
    }));
  }
}, wo = class {
  constructor(e2) {
    this.isMounted = false, this.node = e2;
  }
  update() {
  }
};
function To({ top: e2, left: t2, right: n2, bottom: r2 }) {
  return { x: { min: t2, max: n2 }, y: { min: e2, max: r2 } };
}
function Eo({ x: e2, y: t2 }) {
  return { top: t2.min, right: e2.max, bottom: t2.max, left: e2.min };
}
function Do(e2, t2) {
  if (!t2) return e2;
  let n2 = t2({ x: e2.left, y: e2.top }), r2 = t2({ x: e2.right, y: e2.bottom });
  return { top: n2.y, left: n2.x, bottom: r2.y, right: r2.x };
}
function Oo(e2) {
  return e2 === void 0 || e2 === 1;
}
function ko({ scale: e2, scaleX: t2, scaleY: n2 }) {
  return !Oo(e2) || !Oo(t2) || !Oo(n2);
}
function Ao(e2) {
  return ko(e2) || jo(e2) || e2.z || e2.rotate || e2.rotateX || e2.rotateY || e2.skewX || e2.skewY;
}
function jo(e2) {
  return Mo(e2.x) || Mo(e2.y);
}
function Mo(e2) {
  return e2 && e2 !== `0%`;
}
function No(e2, t2, n2) {
  return n2 + t2 * (e2 - n2);
}
function Po(e2, t2, n2, r2, i2) {
  return i2 !== void 0 && (e2 = No(e2, i2, r2)), No(e2, n2, r2) + t2;
}
function Fo(e2, t2 = 0, n2 = 1, r2, i2) {
  e2.min = Po(e2.min, t2, n2, r2, i2), e2.max = Po(e2.max, t2, n2, r2, i2);
}
function Io(e2, { x: t2, y: n2 }) {
  Fo(e2.x, t2.translate, t2.scale, t2.originPoint), Fo(e2.y, n2.translate, n2.scale, n2.originPoint);
}
var Lo = 0.999999999999, Ro = 1.0000000000001;
function zo(e2, t2, n2, r2 = false) {
  let i2 = n2.length;
  if (!i2) return;
  t2.x = t2.y = 1;
  let a2, o2;
  for (let s2 = 0; s2 < i2; s2++) {
    a2 = n2[s2], o2 = a2.projectionDelta;
    let { visualElement: i3 } = a2.options;
    i3 && i3.props.style && i3.props.style.display === `contents` || (r2 && a2.options.layoutScroll && a2.scroll && a2 !== a2.root && (Bo(e2.x, -a2.scroll.offset.x), Bo(e2.y, -a2.scroll.offset.y)), o2 && (t2.x *= o2.x.scale, t2.y *= o2.y.scale, Io(e2, o2)), r2 && Ao(a2.latestValues) && Uo(e2, a2.latestValues, a2.layout?.layoutBox));
  }
  t2.x < Ro && t2.x > Lo && (t2.x = 1), t2.y < Ro && t2.y > Lo && (t2.y = 1);
}
function Bo(e2, t2) {
  e2.min += t2, e2.max += t2;
}
function Vo(e2, t2, n2, r2, i2 = 0.5) {
  Fo(e2, t2, n2, P(e2.min, e2.max, i2), r2);
}
function Ho(e2, t2) {
  return typeof e2 == `string` ? parseFloat(e2) / 100 * (t2.max - t2.min) : e2;
}
function Uo(e2, t2, n2) {
  let r2 = n2 ?? e2;
  Vo(e2.x, Ho(t2.x, r2.x), t2.scaleX, t2.scale, t2.originX), Vo(e2.y, Ho(t2.y, r2.y), t2.scaleY, t2.scale, t2.originY);
}
function Wo(e2, t2) {
  return To(Do(e2.getBoundingClientRect(), t2));
}
function Go(e2, t2, n2) {
  let r2 = Wo(e2, n2), { scroll: i2 } = t2;
  return i2 && (Bo(r2.x, i2.offset.x), Bo(r2.y, i2.offset.y)), r2;
}
var Ko = { x: `translateX`, y: `translateY`, z: `translateZ`, transformPerspective: `perspective` }, qo = xr.length;
function Jo(e2, t2, n2) {
  let r2 = ``, i2 = true;
  for (let a3 = 0; a3 < qo; a3++) {
    let o2 = xr[a3], s2 = e2[o2];
    if (s2 === void 0) continue;
    let c2 = true;
    if (typeof s2 == `number`) c2 = s2 === +!!o2.startsWith(`scale`);
    else {
      let e3 = parseFloat(s2);
      c2 = o2.startsWith(`scale`) ? e3 === 1 : e3 === 0;
    }
    if (!c2 || n2) {
      let e3 = ga(s2, oa[o2]);
      if (!c2) {
        i2 = false;
        let t3 = Ko[o2] || o2;
        r2 += `${t3}(${e3}) `;
      }
      n2 && (t2[o2] = e3);
    }
  }
  let a2 = e2.pathRotation;
  return a2 && (i2 = false, r2 += `rotate(${ga(a2, oa.pathRotation)}) `), r2 = r2.trim(), n2 ? r2 = n2(t2, i2 ? `` : r2) : i2 && (r2 = `none`), r2;
}
function Yo(e2, t2, n2) {
  let { style: r2, vars: i2, transformOrigin: a2 } = e2, o2 = false, s2 = false;
  for (let e3 in t2) {
    let n3 = t2[e3];
    if (Sr.has(e3)) {
      o2 = true;
      continue;
    } else if (wt(e3)) {
      i2[e3] = n3;
      continue;
    } else {
      let t3 = ga(n3, oa[e3]);
      e3.startsWith(`origin`) ? (s2 = true, a2[e3] = t3) : r2[e3] = t3;
    }
  }
  if (t2.transform || (o2 || n2 ? r2.transform = Jo(t2, e2.transform, n2) : r2.transform &&= `none`), s2) {
    let { originX: e3 = `50%`, originY: t3 = `50%`, originZ: n3 = 0 } = a2;
    r2.transformOrigin = `${e3} ${t3} ${n3}`;
  }
}
function Xo(e2, { style: t2, vars: n2 }, r2, i2) {
  let a2 = e2.style, o2;
  for (o2 in t2) a2[o2] = t2[o2];
  for (o2 in i2?.applyProjectionStyles(a2, r2), n2) a2.setProperty(o2, n2[o2]);
}
function Zo(e2, t2) {
  return t2.max === t2.min ? 0 : e2 / (t2.max - t2.min) * 100;
}
var Qo = { correct: (e2, t2) => {
  if (!t2.target) return e2;
  if (typeof e2 == `string`) if (M.test(e2)) e2 = parseFloat(e2);
  else return e2;
  return `${Zo(e2, t2.target.x)}% ${Zo(e2, t2.target.y)}%`;
} }, $o = { correct: (e2, { treeScale: t2, projectionDelta: n2 }) => {
  let r2 = e2, i2 = fn.parse(e2);
  if (i2.length > 5) return r2;
  let a2 = fn.createTransformer(e2), o2 = typeof i2[0] == `number` ? 0 : 1, s2 = n2.x.scale * t2.x, c2 = n2.y.scale * t2.y;
  i2[0 + o2] /= s2, i2[1 + o2] /= c2;
  let l2 = P(s2, c2, 0.5);
  return typeof i2[2 + o2] == `number` && (i2[2 + o2] /= l2), typeof i2[3 + o2] == `number` && (i2[3 + o2] /= l2), a2(i2);
} }, es = { borderRadius: { ...Qo, applyTo: [...ma] }, borderTopLeftRadius: Qo, borderTopRightRadius: Qo, borderBottomLeftRadius: Qo, borderBottomRightRadius: Qo, boxShadow: $o };
function ts(e2, { layout: t2, layoutId: n2 }) {
  return Sr.has(e2) || e2.startsWith(`origin`) || (t2 || n2 !== void 0) && (!!es[e2] || e2 === `opacity`);
}
function ns(e2, t2, n2) {
  let r2 = e2.style, i2 = t2?.style, a2 = {};
  if (!r2) return a2;
  for (let t3 in r2) (Ri(r2[t3]) || i2 && Ri(i2[t3]) || ts(t3, e2) || n2?.getValue(t3)?.liveStyle !== void 0) && (a2[t3] = r2[t3]);
  return a2;
}
function rs(e2) {
  return window.getComputedStyle(e2);
}
var is = class extends Co {
  constructor() {
    super(...arguments), this.type = `html`, this.renderInstance = Xo;
  }
  readValueFromInstance(e2, t2) {
    if (Sr.has(t2)) return this.projection?.isProjecting ? _r(t2) : yr(e2, t2);
    {
      let n2 = rs(e2), r2 = (wt(t2) ? n2.getPropertyValue(t2) : n2[t2]) || 0;
      return typeof r2 == `string` ? r2.trim() : r2;
    }
  }
  measureInstanceViewportBox(e2, { transformPagePoint: t2 }) {
    return Wo(e2, t2);
  }
  build(e2, t2, n2) {
    Yo(e2, t2, n2.transformTemplate);
  }
  scrapeMotionValuesFromProps(e2, t2, n2) {
    return ns(e2, t2, n2);
  }
}, as = { offset: `stroke-dashoffset`, array: `stroke-dasharray` }, os = { offset: `strokeDashoffset`, array: `strokeDasharray` };
function ss(e2, t2, n2 = 1, r2 = 0, i2 = true) {
  e2.pathLength = 1;
  let a2 = i2 ? as : os;
  e2[a2.offset] = `${-r2}`, e2[a2.array] = `${t2} ${n2}`;
}
var cs = [`offsetDistance`, `offsetPath`, `offsetRotate`, `offsetAnchor`];
function ls(e2, { attrX: t2, attrY: n2, attrScale: r2, pathLength: i2, pathSpacing: a2 = 1, pathOffset: o2 = 0, ...s2 }, c2, l2, u2) {
  if (Yo(e2, s2, l2), c2) {
    e2.style.viewBox && (e2.attrs.viewBox = e2.style.viewBox);
    return;
  }
  e2.attrs = e2.style, e2.style = {};
  let { attrs: d2, style: f2 } = e2;
  d2.transform && (f2.transform = d2.transform, delete d2.transform), (f2.transform || d2.transformOrigin) && (f2.transformOrigin = d2.transformOrigin ?? `50% 50%`, delete d2.transformOrigin), f2.transform && (f2.transformBox = u2?.transformBox ?? `fill-box`, delete d2.transformBox);
  for (let e3 of cs) d2[e3] !== void 0 && (f2[e3] = d2[e3], delete d2[e3]);
  t2 !== void 0 && (d2.x = t2), n2 !== void 0 && (d2.y = n2), r2 !== void 0 && (d2.scale = r2), i2 !== void 0 && ss(d2, i2, a2, o2, false);
}
var us = /* @__PURE__ */ new Set([`baseFrequency`, `diffuseConstant`, `kernelMatrix`, `kernelUnitLength`, `keySplines`, `keyTimes`, `limitingConeAngle`, `markerHeight`, `markerWidth`, `numOctaves`, `targetX`, `targetY`, `surfaceScale`, `specularConstant`, `specularExponent`, `stdDeviation`, `tableValues`, `viewBox`, `gradientTransform`, `pathLength`, `startOffset`, `textLength`, `lengthAdjust`]), ds = (e2) => typeof e2 == `string` && e2.toLowerCase() === `svg`;
function fs(e2, t2, n2, r2) {
  Xo(e2, t2, void 0, r2);
  for (let n3 in t2.attrs) e2.setAttribute(us.has(n3) ? n3 : Vi(n3), t2.attrs[n3]);
}
function ps(e2, t2, n2) {
  let r2 = ns(e2, t2, n2);
  for (let n3 in e2) if (Ri(e2[n3]) || Ri(t2[n3])) {
    let t3 = xr.indexOf(n3) === -1 ? n3 : `attr` + n3.charAt(0).toUpperCase() + n3.substring(1);
    r2[t3] = e2[n3];
  }
  return r2;
}
var ms = class extends Co {
  constructor() {
    super(...arguments), this.type = `svg`, this.isSVGTag = false, this.measureInstanceViewportBox = io;
  }
  getBaseTargetFromProps(e2, t2) {
    return e2[t2];
  }
  readValueFromInstance(e2, t2) {
    if (Sr.has(t2)) {
      let e3 = ca(t2);
      return e3 && e3.default || 0;
    }
    return t2 = us.has(t2) ? t2 : Vi(t2), e2.getAttribute(t2);
  }
  scrapeMotionValuesFromProps(e2, t2, n2) {
    return ps(e2, t2, n2);
  }
  build(e2, t2, n2) {
    ls(e2, t2, this.isSVGTag, n2.transformTemplate, n2.style);
  }
  renderInstance(e2, t2, n2, r2) {
    fs(e2, t2, n2, r2);
  }
  mount(e2) {
    this.isSVGTag = ds(e2.tagName), super.mount(e2);
  }
}, hs = lo.length;
function gs(e2) {
  if (!e2) return;
  if (!e2.isControllingVariants) {
    let t3 = e2.parent && gs(e2.parent) || {};
    return e2.props.initial !== void 0 && (t3.initial = e2.props.initial), t3;
  }
  let t2 = {};
  for (let n2 = 0; n2 < hs; n2++) {
    let r2 = lo[n2], i2 = e2.props[r2];
    (so(i2) || i2 === false) && (t2[r2] = i2);
  }
  return t2;
}
function _s(e2, t2) {
  if (!Array.isArray(t2)) return false;
  let n2 = t2.length;
  if (n2 !== e2.length) return false;
  for (let r2 = 0; r2 < n2; r2++) if (t2[r2] !== e2[r2]) return false;
  return true;
}
var vs = [...co].reverse(), ys = co.length;
function bs(e2) {
  return (t2) => Promise.all(t2.map(({ animation: t3, options: n2 }) => Ji(e2, t3, n2)));
}
function xs(e2) {
  let t2 = bs(e2), n2 = ws(), r2 = true, i2 = false, a2 = (t3) => (n3, r3) => {
    let i3 = I(e2, r3, t3 === `exit` ? e2.presenceContext?.custom : void 0);
    if (i3) {
      let { transition: e3, transitionEnd: t4, ...r4 } = i3;
      n3 = { ...n3, ...r4, ...t4 };
    }
    return n3;
  };
  function o2(n3) {
    t2 = n3(e2);
  }
  function s2(o3) {
    let { props: s3 } = e2, c3 = gs(e2.parent) || {}, l2 = [], u2 = /* @__PURE__ */ new Set(), d2 = {}, f2 = 1 / 0;
    for (let t3 = 0; t3 < ys; t3++) {
      let p3 = vs[t3], m2 = n2[p3], h2 = s3[p3] === void 0 ? c3[p3] : s3[p3], g2 = so(h2), _2 = p3 === o3 ? m2.isActive : null;
      _2 === false && (f2 = t3);
      let v2 = h2 === c3[p3] && h2 !== s3[p3] && g2;
      if (v2 && (r2 || i2) && e2.manuallyAnimateOnMount && (v2 = false), m2.protectedKeys = { ...d2 }, !m2.isActive && _2 === null || !h2 && !m2.prevProp || oo(h2) || typeof h2 == `boolean`) continue;
      if (p3 === `exit` && m2.isActive && _2 !== true) {
        m2.prevResolvedValues && (d2 = { ...d2, ...m2.prevResolvedValues });
        continue;
      }
      let y2 = Ss(m2.prevProp, h2), b2 = y2 || p3 === o3 && m2.isActive && !v2 && g2 || t3 > f2 && g2, x2 = false, S2 = Array.isArray(h2) ? h2 : [h2], C2 = S2.reduce(a2(p3), {});
      _2 === false && (C2 = {});
      let { prevResolvedValues: ee2 = {} } = m2, te2 = { ...ee2, ...C2 }, ne2 = (t4) => {
        b2 = true, u2.has(t4) && (x2 = true, u2.delete(t4)), m2.needsAnimating[t4] = true;
        let n3 = e2.getValue(t4);
        n3 && (n3.liveStyle = false);
      };
      for (let e3 in te2) {
        let t4 = C2[e3], n3 = ee2[e3];
        if (d2.hasOwnProperty(e3)) continue;
        let r3 = false;
        r3 = Pi(t4) && Pi(n3) ? !_s(t4, n3) || y2 : t4 !== n3, r3 ? t4 == null ? u2.add(e3) : ne2(e3) : t4 !== void 0 && u2.has(e3) ? ne2(e3) : m2.protectedKeys[e3] = true;
      }
      m2.prevProp = h2, m2.prevResolvedValues = C2, m2.isActive && (d2 = { ...d2, ...C2 }), (r2 || i2) && e2.blockInitialAnimation && (b2 = false);
      let re2 = v2 && y2;
      b2 && (!re2 || x2) && l2.push(...S2.map((t4) => {
        let n3 = { type: p3 };
        if (typeof t4 == `string` && (r2 || i2) && !re2 && e2.manuallyAnimateOnMount && e2.parent) {
          let { parent: r3 } = e2, i3 = I(r3, t4);
          if (r3.enteringChildren && i3) {
            let { delayChildren: t5 } = i3.transition || {};
            n3.delay = fi(r3.enteringChildren, e2, t5);
          }
        }
        return { animation: t4, options: n3 };
      }));
    }
    if (u2.size) {
      let t3 = {};
      if (typeof s3.initial != `boolean`) {
        let n3 = I(e2, Array.isArray(s3.initial) ? s3.initial[0] : s3.initial);
        n3 && n3.transition && (t3.transition = n3.transition);
      }
      u2.forEach((n3) => {
        let r3 = e2.getBaseTarget(n3), i3 = e2.getValue(n3);
        i3 && (i3.liveStyle = true), t3[n3] = r3 ?? null;
      }), l2.push({ animation: t3 });
    }
    let p2 = !!l2.length;
    return r2 && (s3.initial === false || s3.initial === s3.animate) && !e2.manuallyAnimateOnMount && (p2 = false), r2 = false, i2 = false, p2 ? t2(l2) : Promise.resolve();
  }
  function c2(t3, r3) {
    if (n2[t3].isActive === r3) return Promise.resolve();
    e2.variantChildren?.forEach((e3) => e3.animationState?.setActive(t3, r3)), n2[t3].isActive = r3;
    let i3 = s2(t3);
    for (let e3 in n2) n2[e3].protectedKeys = {};
    return i3;
  }
  return { animateChanges: s2, setActive: c2, setAnimateFunction: o2, getState: () => n2, reset: () => {
    n2 = ws(), i2 = true;
  } };
}
function Ss(e2, t2) {
  return typeof t2 == `string` ? t2 !== e2 : Array.isArray(t2) ? !_s(t2, e2) : false;
}
function Cs(e2 = false) {
  return { isActive: e2, protectedKeys: {}, needsAnimating: {}, prevResolvedValues: {} };
}
function ws() {
  return { animate: Cs(true), whileInView: Cs(), whileHover: Cs(), whileTap: Cs(), whileDrag: Cs(), whileFocus: Cs(), exit: Cs() };
}
function Ts(e2, t2) {
  e2.min = t2.min, e2.max = t2.max;
}
function Es(e2, t2) {
  Ts(e2.x, t2.x), Ts(e2.y, t2.y);
}
function Ds(e2, t2) {
  e2.translate = t2.translate, e2.scale = t2.scale, e2.originPoint = t2.originPoint, e2.origin = t2.origin;
}
var Os = 0.9999, ks = 1.0001, As = -0.01, js = 0.01;
function B(e2) {
  return e2.max - e2.min;
}
function Ms(e2, t2, n2) {
  return Math.abs(e2 - t2) <= n2;
}
function Ns(e2, t2, n2, r2 = 0.5) {
  e2.origin = r2, e2.originPoint = P(t2.min, t2.max, e2.origin), e2.scale = B(n2) / B(t2), e2.translate = P(n2.min, n2.max, e2.origin) - e2.originPoint, (e2.scale >= Os && e2.scale <= ks || isNaN(e2.scale)) && (e2.scale = 1), (e2.translate >= As && e2.translate <= js || isNaN(e2.translate)) && (e2.translate = 0);
}
function Ps(e2, t2, n2, r2) {
  Ns(e2.x, t2.x, n2.x, r2 ? r2.originX : void 0), Ns(e2.y, t2.y, n2.y, r2 ? r2.originY : void 0);
}
function Fs(e2, t2, n2, r2 = 0) {
  e2.min = (r2 ? P(n2.min, n2.max, r2) : n2.min) + t2.min, e2.max = e2.min + B(t2);
}
function Is(e2, t2, n2, r2) {
  Fs(e2.x, t2.x, n2.x, r2?.x), Fs(e2.y, t2.y, n2.y, r2?.y);
}
function Ls(e2, t2, n2, r2 = 0) {
  let i2 = r2 ? P(n2.min, n2.max, r2) : n2.min;
  e2.min = t2.min - i2, e2.max = e2.min + B(t2);
}
function Rs(e2, t2, n2, r2) {
  Ls(e2.x, t2.x, n2.x, r2?.x), Ls(e2.y, t2.y, n2.y, r2?.y);
}
function zs(e2, t2, n2, r2, i2) {
  return e2 -= t2, e2 = No(e2, 1 / n2, r2), i2 !== void 0 && (e2 = No(e2, 1 / i2, r2)), e2;
}
function Bs(e2, t2 = 0, n2 = 1, r2 = 0.5, i2, a2 = e2, o2 = e2) {
  if (Gt.test(t2) && (t2 = parseFloat(t2), t2 = P(o2.min, o2.max, t2 / 100) - o2.min), typeof t2 != `number`) return;
  let s2 = P(a2.min, a2.max, r2);
  e2 === a2 && (s2 -= t2), e2.min = zs(e2.min, t2, n2, s2, i2), e2.max = zs(e2.max, t2, n2, s2, i2);
}
function Vs(e2, t2, [n2, r2, i2], a2, o2) {
  Bs(e2, t2[n2], t2[r2], t2[i2], t2.scale, a2, o2);
}
var Hs = [`x`, `scaleX`, `originX`], Us = [`y`, `scaleY`, `originY`];
function Ws(e2, t2, n2, r2) {
  Vs(e2.x, t2, Hs, n2 ? n2.x : void 0, r2 ? r2.x : void 0), Vs(e2.y, t2, Us, n2 ? n2.y : void 0, r2 ? r2.y : void 0);
}
function Gs(e2) {
  return e2.translate === 0 && e2.scale === 1;
}
function Ks(e2) {
  return Gs(e2.x) && Gs(e2.y);
}
function qs(e2, t2) {
  return e2.min === t2.min && e2.max === t2.max;
}
function Js(e2, t2) {
  return qs(e2.x, t2.x) && qs(e2.y, t2.y);
}
function Ys(e2, t2) {
  return Math.round(e2.min) === Math.round(t2.min) && Math.round(e2.max) === Math.round(t2.max);
}
function Xs(e2, t2) {
  return Ys(e2.x, t2.x) && Ys(e2.y, t2.y);
}
function Zs(e2) {
  return B(e2.x) / B(e2.y);
}
function Qs(e2, t2) {
  return e2.translate === t2.translate && e2.scale === t2.scale && e2.originPoint === t2.originPoint;
}
function $s(e2) {
  return [e2(`x`), e2(`y`)];
}
function ec(e2, t2, n2) {
  let r2 = ``, i2 = e2.x.translate / t2.x, a2 = e2.y.translate / t2.y, o2 = n2?.z || 0;
  if ((i2 || a2 || o2) && (r2 = `translate3d(${i2}px, ${a2}px, ${o2}px) `), (t2.x !== 1 || t2.y !== 1) && (r2 += `scale(${1 / t2.x}, ${1 / t2.y}) `), n2) {
    let { transformPerspective: e3, rotate: t3, pathRotation: i3, rotateX: a3, rotateY: o3, skewX: s3, skewY: c3 } = n2;
    e3 && (r2 = `perspective(${e3}px) ${r2}`), t3 && (r2 += `rotate(${t3}deg) `), i3 && (r2 += `rotate(${i3}deg) `), a3 && (r2 += `rotateX(${a3}deg) `), o3 && (r2 += `rotateY(${o3}deg) `), s3 && (r2 += `skewX(${s3}deg) `), c3 && (r2 += `skewY(${c3}deg) `);
  }
  let s2 = e2.x.scale * t2.x, c2 = e2.y.scale * t2.y;
  return (s2 !== 1 || c2 !== 1) && (r2 += `scale(${s2}, ${c2})`), r2 || `none`;
}
var tc = ma.length, nc = (e2) => typeof e2 == `string` ? parseFloat(e2) : e2, rc = (e2) => typeof e2 == `number` || M.test(e2);
function ic(e2, t2, n2, r2, i2, a2) {
  i2 ? (e2.opacity = P(0, n2.opacity ?? 1, oc(r2)), e2.opacityExit = P(t2.opacity ?? 1, 0, sc(r2))) : a2 && (e2.opacity = P(t2.opacity ?? 1, n2.opacity ?? 1, r2));
  for (let i3 = 0; i3 < tc; i3++) {
    let a3 = ma[i3], o2 = ac(t2, a3), s2 = ac(n2, a3);
    o2 === void 0 && s2 === void 0 || (o2 ||= 0, s2 ||= 0, o2 === 0 || s2 === 0 || rc(o2) === rc(s2) ? (e2[a3] = Math.max(P(nc(o2), nc(s2), r2), 0), (Gt.test(s2) || Gt.test(o2)) && (e2[a3] += `%`)) : e2[a3] = s2);
  }
  (t2.rotate || n2.rotate) && (e2.rotate = P(t2.rotate || 0, n2.rotate || 0, r2));
}
function ac(e2, t2) {
  return e2[t2] === void 0 ? e2.borderRadius : e2[t2];
}
var oc = cc(0, 0.5, it), sc = cc(0.5, 0.95, k);
function cc(e2, t2, n2) {
  return (r2) => r2 < e2 ? 0 : r2 > t2 ? 1 : n2(Ve(e2, t2, r2));
}
function lc(e2, t2, n2) {
  let r2 = Ri(e2) ? e2 : _i(e2);
  return r2.start(Di(``, r2, t2, n2)), r2.animation;
}
function uc(e2, t2, n2, r2 = { passive: true }) {
  return e2.addEventListener(t2, n2, r2), () => e2.removeEventListener(t2, n2, r2);
}
var dc = (e2, t2) => e2.depth - t2.depth, fc = class {
  constructor() {
    this.children = [], this.isDirty = false;
  }
  add(e2) {
    Me(this.children, e2), this.isDirty = true;
  }
  remove(e2) {
    Ne(this.children, e2), this.isDirty = true;
  }
  forEach(e2) {
    this.isDirty && this.children.sort(dc), this.isDirty = false, this.children.forEach(e2);
  }
};
function pc(e2, t2) {
  let n2 = St.now(), r2 = ({ timestamp: i2 }) => {
    let a2 = i2 - n2;
    a2 >= t2 && (vt(r2), e2(a2 - t2));
  };
  return A.setup(r2, true), () => vt(r2);
}
function mc(e2) {
  return Ri(e2) ? e2.get() : e2;
}
var hc = class {
  constructor() {
    this.members = [];
  }
  add(e2) {
    Me(this.members, e2);
    for (let t2 = this.members.length - 1; t2 >= 0; t2--) {
      let n2 = this.members[t2];
      if (n2 === e2 || n2 === this.lead || n2 === this.prevLead) continue;
      let r2 = n2.instance;
      (!r2 || r2.isConnected === false) && !n2.snapshot && (Ne(this.members, n2), n2.unmount());
    }
    e2.scheduleRender();
  }
  remove(e2) {
    if (Ne(this.members, e2), e2 === this.prevLead && (this.prevLead = void 0), e2 === this.lead) {
      let e3 = this.members[this.members.length - 1];
      e3 && this.promote(e3);
    }
  }
  relegate(e2) {
    for (let t2 = this.members.indexOf(e2) - 1; t2 >= 0; t2--) {
      let e3 = this.members[t2];
      if (e3.isPresent !== false && e3.instance?.isConnected !== false) return this.promote(e3), true;
    }
    return false;
  }
  promote(e2, t2) {
    let n2 = this.lead;
    if (e2 !== n2 && (this.prevLead = n2, this.lead = e2, e2.show(), n2)) {
      n2.updateSnapshot(), e2.scheduleRender();
      let { layoutDependency: r2 } = n2.options, { layoutDependency: i2 } = e2.options;
      (r2 === void 0 || r2 !== i2) && (e2.resumeFrom = n2, t2 && (n2.preserveOpacity = true), n2.snapshot && (e2.snapshot = n2.snapshot, e2.snapshot.latestValues = n2.animationValues || n2.latestValues), e2.root?.isUpdating && (e2.isLayoutDirty = true)), e2.options.crossfade === false && n2.hide();
    }
  }
  exitAnimationComplete() {
    this.members.forEach((e2) => {
      e2.options.onExitComplete?.(), e2.resumingFrom?.options.onExitComplete?.();
    });
  }
  scheduleRender() {
    this.members.forEach((e2) => e2.instance && e2.scheduleRender(false));
  }
  removeLeadSnapshot() {
    this.lead?.snapshot && (this.lead.snapshot = void 0);
  }
}, gc = { hasAnimatedSinceResize: true, hasEverUpdated: false }, _c = { nodes: 0, calculatedTargetDeltas: 0, calculatedProjections: 0 }, vc = [``, `X`, `Y`, `Z`], yc = 1e3, bc = 0;
function xc(e2, t2, n2, r2) {
  let { latestValues: i2 } = t2;
  i2[e2] && (n2[e2] = i2[e2], t2.setStaticValue(e2, 0), r2 && (r2[e2] = 0));
}
function Sc(e2) {
  if (e2.hasCheckedOptimisedAppear = true, e2.root === e2) return;
  let { visualElement: t2 } = e2.options;
  if (!t2) return;
  let n2 = Ui(t2);
  if (window.MotionHasOptimisedAnimation(n2, `transform`)) {
    let { layout: t3, layoutId: r3 } = e2.options;
    window.MotionCancelOptimisedAnimation(n2, `transform`, A, !(t3 || r3));
  }
  let { parent: r2 } = e2;
  r2 && !r2.hasCheckedOptimisedAppear && Sc(r2);
}
function Cc({ attachResizeListener: e2, defaultParent: t2, measureScroll: n2, checkIsScrollRoot: r2, resetTransform: i2 }) {
  return class {
    constructor(e3 = {}, n3 = t2?.()) {
      this.id = bc++, this.animationId = 0, this.animationCommitId = 0, this.children = /* @__PURE__ */ new Set(), this.options = {}, this.isTreeAnimating = false, this.isAnimationBlocked = false, this.isLayoutDirty = false, this.isProjectionDirty = false, this.isSharedProjectionDirty = false, this.isTransformDirty = false, this.updateManuallyBlocked = false, this.updateBlockedByResize = false, this.isUpdating = false, this.isSVG = false, this.needsReset = false, this.shouldResetTransform = false, this.hasCheckedOptimisedAppear = false, this.treeScale = { x: 1, y: 1 }, this.eventHandlers = /* @__PURE__ */ new Map(), this.hasTreeAnimated = false, this.layoutVersion = 0, this.updateScheduled = false, this.scheduleUpdate = () => this.update(), this.projectionUpdateScheduled = false, this.checkUpdateFailed = () => {
        this.isUpdating && (this.isUpdating = false, this.clearAllSnapshots());
      }, this.updateProjection = () => {
        this.projectionUpdateScheduled = false, Za.value && (_c.nodes = _c.calculatedTargetDeltas = _c.calculatedProjections = 0), this.nodes.forEach(Ec), this.nodes.forEach(Fc), this.nodes.forEach(Ic), this.nodes.forEach(Dc), Za.addProjectionMetrics && Za.addProjectionMetrics(_c);
      }, this.resolvedRelativeTargetAt = 0, this.linkedParentVersion = 0, this.hasProjected = false, this.isVisible = true, this.animationProgress = 0, this.sharedNodes = /* @__PURE__ */ new Map(), this.latestValues = e3, this.root = n3 ? n3.root || n3 : this, this.path = n3 ? [...n3.path, n3] : [], this.parent = n3, this.depth = n3 ? n3.depth + 1 : 0;
      for (let e4 = 0; e4 < this.path.length; e4++) this.path[e4].shouldResetTransform = true;
      this.root === this && (this.nodes = new fc());
    }
    addEventListener(e3, t3) {
      return this.eventHandlers.has(e3) || this.eventHandlers.set(e3, new He()), this.eventHandlers.get(e3).add(t3);
    }
    notifyListeners(e3, ...t3) {
      let n3 = this.eventHandlers.get(e3);
      n3 && n3.notify(...t3);
    }
    hasListeners(e3) {
      return this.eventHandlers.has(e3);
    }
    mount(t3) {
      if (this.instance) return;
      this.isSVG = za(t3) && !Qa(t3), this.instance = t3;
      let { layoutId: n3, layout: r3, visualElement: i3 } = this.options;
      if (i3 && !i3.current && i3.mount(t3), this.root.nodes.add(this), this.parent && this.parent.children.add(this), this.root.hasTreeAnimated && (r3 || n3) && (this.isLayoutDirty = true), e2) {
        let n4, r4 = 0, i4 = () => this.root.updateBlockedByResize = false;
        A.read(() => {
          r4 = window.innerWidth;
        }), e2(t3, () => {
          let e3 = window.innerWidth;
          e3 !== r4 && (r4 = e3, this.root.updateBlockedByResize = true, n4 && n4(), n4 = pc(i4, 250), gc.hasAnimatedSinceResize && (gc.hasAnimatedSinceResize = false, this.nodes.forEach(Pc)));
        });
      }
      n3 && this.root.registerSharedNode(n3, this), this.options.animate !== false && i3 && (n3 || r3) && this.addEventListener(`didUpdate`, ({ delta: e3, hasLayoutChanged: t4, hasRelativeLayoutChanged: n4, layout: r4 }) => {
        if (this.isTreeAnimationBlocked()) {
          this.target = void 0, this.relativeTarget = void 0;
          return;
        }
        let a2 = this.options.transition || i3.getDefaultTransition() || Uc, { onLayoutAnimationStart: o2, onLayoutAnimationComplete: s2 } = i3.getProps(), c2 = !this.targetLayout || !Xs(this.targetLayout, r4), l2 = !t4 && n4;
        if (this.options.layoutRoot || this.resumeFrom || l2 || t4 && (c2 || !this.currentAnimation)) {
          this.resumeFrom && (this.resumingFrom = this.resumeFrom, this.resumingFrom.resumingFrom = void 0);
          let t5 = { ...yi(a2, `layout`), onPlay: o2, onComplete: s2 };
          (i3.shouldReduceMotion || this.options.layoutRoot) && (t5.delay = 0, t5.type = false), this.startAnimation(t5), this.setAnimationOrigin(e3, l2, t5.path);
        } else t4 || Pc(this), this.isLead() && this.options.onExitComplete && this.options.onExitComplete();
        this.targetLayout = r4;
      });
    }
    unmount() {
      this.options.layoutId && this.willUpdate(), this.root.nodes.remove(this);
      let e3 = this.getStack();
      e3 && e3.remove(this), this.parent && this.parent.children.delete(this), this.instance = void 0, this.eventHandlers.clear(), vt(this.updateProjection);
    }
    blockUpdate() {
      this.updateManuallyBlocked = true;
    }
    unblockUpdate() {
      this.updateManuallyBlocked = false;
    }
    isUpdateBlocked() {
      return this.updateManuallyBlocked || this.updateBlockedByResize;
    }
    isTreeAnimationBlocked() {
      return this.isAnimationBlocked || this.parent && this.parent.isTreeAnimationBlocked() || false;
    }
    startUpdate() {
      this.isUpdateBlocked() || (this.isUpdating = true, this.nodes && this.nodes.forEach(Lc), this.animationId++);
    }
    getTransformTemplate() {
      let { visualElement: e3 } = this.options;
      return e3 && e3.getProps().transformTemplate;
    }
    willUpdate(e3 = true) {
      if (this.root.hasTreeAnimated = true, this.root.isUpdateBlocked()) {
        this.options.onExitComplete && this.options.onExitComplete();
        return;
      }
      if (window.MotionCancelOptimisedAnimation && !this.hasCheckedOptimisedAppear && Sc(this), !this.root.isUpdating && this.root.startUpdate(), this.isLayoutDirty) return;
      this.isLayoutDirty = true;
      for (let e4 = 0; e4 < this.path.length; e4++) {
        let t4 = this.path[e4];
        t4.shouldResetTransform = true, (typeof t4.latestValues.x == `string` || typeof t4.latestValues.y == `string`) && (t4.isLayoutDirty = true), t4.updateScroll(`snapshot`), t4.options.layoutRoot && t4.willUpdate(false);
      }
      let { layoutId: t3, layout: n3 } = this.options;
      if (t3 === void 0 && !n3) return;
      let r3 = this.getTransformTemplate();
      this.prevTransformTemplateValue = r3 ? r3(this.latestValues, ``) : void 0, this.updateSnapshot(), e3 && this.notifyListeners(`willUpdate`);
    }
    update() {
      if (this.updateScheduled = false, this.isUpdateBlocked()) {
        let e4 = this.updateBlockedByResize;
        this.unblockUpdate(), this.updateBlockedByResize = false, this.clearAllSnapshots(), e4 && this.nodes.forEach(Ac), this.nodes.forEach(kc);
        return;
      }
      if (this.animationId <= this.animationCommitId) {
        this.nodes.forEach(jc);
        return;
      }
      this.animationCommitId = this.animationId, this.isUpdating ? (this.isUpdating = false, this.nodes.forEach(Mc), this.nodes.forEach(Nc), this.nodes.forEach(wc), this.nodes.forEach(Tc)) : this.nodes.forEach(jc), this.clearAllSnapshots();
      let e3 = St.now();
      j.delta = Pe(0, 1e3 / 60, e3 - j.timestamp), j.timestamp = e3, j.isProcessing = true, yt.update.process(j), yt.preRender.process(j), yt.render.process(j), j.isProcessing = false;
    }
    didUpdate() {
      this.updateScheduled || (this.updateScheduled = true, va.read(this.scheduleUpdate));
    }
    clearAllSnapshots() {
      this.nodes.forEach(Oc), this.sharedNodes.forEach(Rc);
    }
    scheduleUpdateProjection() {
      this.projectionUpdateScheduled || (this.projectionUpdateScheduled = true, A.preRender(this.updateProjection, false, true));
    }
    scheduleCheckAfterUnmount() {
      A.postRender(() => {
        this.isLayoutDirty ? this.root.didUpdate() : this.root.checkUpdateFailed();
      });
    }
    updateSnapshot() {
      this.snapshot || !this.instance || (this.snapshot = this.measure(), this.snapshot && !B(this.snapshot.measuredBox.x) && !B(this.snapshot.measuredBox.y) && (this.snapshot = void 0));
    }
    updateLayout() {
      if (!this.instance || (this.updateScroll(), !(this.options.alwaysMeasureLayout && this.isLead()) && !this.isLayoutDirty)) return;
      if (this.resumeFrom && !this.resumeFrom.instance) for (let e4 = 0; e4 < this.path.length; e4++) this.path[e4].updateScroll();
      let e3 = this.layout;
      this.layout = this.measure(false), this.layoutVersion++, this.layoutCorrected ||= io(), this.isLayoutDirty = false, this.projectionDelta = void 0, this.notifyListeners(`measure`, this.layout.layoutBox);
      let { visualElement: t3 } = this.options;
      t3 && t3.notify(`LayoutMeasure`, this.layout.layoutBox, e3 ? e3.layoutBox : void 0);
    }
    updateScroll(e3 = `measure`) {
      let t3 = !!(this.options.layoutScroll && this.instance);
      if (this.scroll && this.scroll.animationId === this.root.animationId && this.scroll.phase === e3 && (t3 = false), t3 && this.instance) {
        let t4 = r2(this.instance);
        this.scroll = { animationId: this.root.animationId, phase: e3, isRoot: t4, offset: n2(this.instance), wasRoot: this.scroll ? this.scroll.isRoot : t4 };
      }
    }
    resetTransform() {
      if (!i2) return;
      let e3 = this.isLayoutDirty || this.shouldResetTransform || this.options.alwaysMeasureLayout, t3 = this.projectionDelta && !Ks(this.projectionDelta), n3 = this.getTransformTemplate(), r3 = n3 ? n3(this.latestValues, ``) : void 0, a2 = r3 !== this.prevTransformTemplateValue;
      e3 && this.instance && (t3 || Ao(this.latestValues) || a2) && (i2(this.instance, r3), this.shouldResetTransform = false, this.scheduleRender());
    }
    measure(e3 = true) {
      let t3 = this.measurePageBox(), n3 = this.removeElementScroll(t3);
      return e3 && (n3 = this.removeTransform(n3)), qc(n3), { animationId: this.root.animationId, measuredBox: t3, layoutBox: n3, latestValues: {}, source: this.id };
    }
    measurePageBox() {
      let { visualElement: e3 } = this.options;
      if (!e3) return io();
      let t3 = e3.measureViewportBox();
      if (!(this.scroll?.wasRoot || this.path.some(Yc))) {
        let { scroll: e4 } = this.root;
        e4 && (Bo(t3.x, e4.offset.x), Bo(t3.y, e4.offset.y));
      }
      return t3;
    }
    removeElementScroll(e3) {
      let t3 = io();
      if (Es(t3, e3), this.scroll?.wasRoot) return t3;
      for (let n3 = 0; n3 < this.path.length; n3++) {
        let r3 = this.path[n3], { scroll: i3, options: a2 } = r3;
        r3 !== this.root && i3 && a2.layoutScroll && (i3.wasRoot && Es(t3, e3), Bo(t3.x, i3.offset.x), Bo(t3.y, i3.offset.y));
      }
      return t3;
    }
    applyTransform(e3, t3 = false, n3) {
      let r3 = n3 || io();
      Es(r3, e3);
      for (let e4 = 0; e4 < this.path.length; e4++) {
        let n4 = this.path[e4];
        !t3 && n4.options.layoutScroll && n4.scroll && n4 !== n4.root && (Bo(r3.x, -n4.scroll.offset.x), Bo(r3.y, -n4.scroll.offset.y)), Ao(n4.latestValues) && Uo(r3, n4.latestValues, n4.layout?.layoutBox);
      }
      return Ao(this.latestValues) && Uo(r3, this.latestValues, this.layout?.layoutBox), r3;
    }
    removeTransform(e3) {
      let t3 = io();
      Es(t3, e3);
      for (let e4 = 0; e4 < this.path.length; e4++) {
        let n3 = this.path[e4];
        if (!Ao(n3.latestValues)) continue;
        let r3;
        n3.instance && (ko(n3.latestValues) && n3.updateSnapshot(), r3 = io(), Es(r3, n3.measurePageBox())), Ws(t3, n3.latestValues, n3.snapshot?.layoutBox, r3);
      }
      return Ao(this.latestValues) && Ws(t3, this.latestValues), t3;
    }
    setTargetDelta(e3) {
      this.targetDelta = e3, this.root.scheduleUpdateProjection(), this.isProjectionDirty = true;
    }
    setOptions(e3) {
      this.options = { ...this.options, ...e3, crossfade: e3.crossfade === void 0 || e3.crossfade };
    }
    clearMeasurements() {
      this.scroll = void 0, this.layout = void 0, this.snapshot = void 0, this.prevTransformTemplateValue = void 0, this.targetDelta = void 0, this.target = void 0, this.isLayoutDirty = false;
    }
    forceRelativeParentToResolveTarget() {
      this.relativeParent && this.relativeParent.resolvedRelativeTargetAt !== j.timestamp && this.relativeParent.resolveTargetDelta(true);
    }
    resolveTargetDelta(e3 = false) {
      let t3 = this.getLead();
      this.isProjectionDirty ||= t3.isProjectionDirty, this.isTransformDirty ||= t3.isTransformDirty, this.isSharedProjectionDirty ||= t3.isSharedProjectionDirty;
      let n3 = !!this.resumingFrom || this !== t3;
      if (!(e3 || n3 && this.isSharedProjectionDirty || this.isProjectionDirty || this.parent?.isProjectionDirty || this.attemptToResolveRelativeTarget || this.root.updateBlockedByResize)) return;
      let { layout: r3, layoutId: i3 } = this.options;
      if (!this.layout || !(r3 || i3)) return;
      this.resolvedRelativeTargetAt = j.timestamp;
      let a2 = this.getClosestProjectingParent();
      a2 && this.linkedParentVersion !== a2.layoutVersion && !a2.options.layoutRoot && this.removeRelativeTarget(), !this.targetDelta && !this.relativeTarget && (this.options.layoutAnchor !== false && a2 && a2.layout ? this.createRelativeTarget(a2, this.layout.layoutBox, a2.layout.layoutBox) : this.removeRelativeTarget()), !(!this.relativeTarget && !this.targetDelta) && (this.target || (this.target = io(), this.targetWithTransforms = io()), this.relativeTarget && this.relativeTargetOrigin && this.relativeParent && this.relativeParent.target ? (this.forceRelativeParentToResolveTarget(), Is(this.target, this.relativeTarget, this.relativeParent.target, this.options.layoutAnchor || void 0)) : this.targetDelta ? (this.resumingFrom ? this.applyTransform(this.layout.layoutBox, false, this.target) : Es(this.target, this.layout.layoutBox), Io(this.target, this.targetDelta)) : Es(this.target, this.layout.layoutBox), this.attemptToResolveRelativeTarget && (this.attemptToResolveRelativeTarget = false, this.options.layoutAnchor !== false && a2 && !!a2.resumingFrom == !!this.resumingFrom && !a2.options.layoutScroll && a2.target && this.animationProgress !== 1 ? this.createRelativeTarget(a2, this.target, a2.target) : this.relativeParent = this.relativeTarget = void 0), Za.value && _c.calculatedTargetDeltas++);
    }
    getClosestProjectingParent() {
      if (!(!this.parent || ko(this.parent.latestValues) || jo(this.parent.latestValues))) return this.parent.isProjecting() ? this.parent : this.parent.getClosestProjectingParent();
    }
    isProjecting() {
      return !!((this.relativeTarget || this.targetDelta || this.options.layoutRoot) && this.layout);
    }
    createRelativeTarget(e3, t3, n3) {
      this.relativeParent = e3, this.linkedParentVersion = e3.layoutVersion, this.forceRelativeParentToResolveTarget(), this.relativeTarget = io(), this.relativeTargetOrigin = io(), Rs(this.relativeTargetOrigin, t3, n3, this.options.layoutAnchor || void 0), Es(this.relativeTarget, this.relativeTargetOrigin);
    }
    removeRelativeTarget() {
      this.relativeParent = this.relativeTarget = void 0;
    }
    calcProjection() {
      let e3 = this.getLead(), t3 = !!this.resumingFrom || this !== e3, n3 = true;
      if ((this.isProjectionDirty || this.parent?.isProjectionDirty) && (n3 = false), t3 && (this.isSharedProjectionDirty || this.isTransformDirty) && (n3 = false), this.resolvedRelativeTargetAt === j.timestamp && (n3 = false), n3) return;
      let { layout: r3, layoutId: i3 } = this.options;
      if (this.isTreeAnimating = !!(this.parent && this.parent.isTreeAnimating || this.currentAnimation || this.pendingAnimation), this.isTreeAnimating || (this.targetDelta = this.relativeTarget = void 0), !this.layout || !(r3 || i3)) return;
      Es(this.layoutCorrected, this.layout.layoutBox);
      let a2 = this.treeScale.x, o2 = this.treeScale.y;
      zo(this.layoutCorrected, this.treeScale, this.path, t3), e3.layout && !e3.target && (this.treeScale.x !== 1 || this.treeScale.y !== 1) && (e3.target = e3.layout.layoutBox, e3.targetWithTransforms = io());
      let { target: s2 } = e3;
      if (!s2) {
        this.prevProjectionDelta && (this.createProjectionDeltas(), this.scheduleRender());
        return;
      }
      !this.projectionDelta || !this.prevProjectionDelta ? this.createProjectionDeltas() : (Ds(this.prevProjectionDelta.x, this.projectionDelta.x), Ds(this.prevProjectionDelta.y, this.projectionDelta.y)), Ps(this.projectionDelta, this.layoutCorrected, s2, this.latestValues), (this.treeScale.x !== a2 || this.treeScale.y !== o2 || !Qs(this.projectionDelta.x, this.prevProjectionDelta.x) || !Qs(this.projectionDelta.y, this.prevProjectionDelta.y)) && (this.hasProjected = true, this.scheduleRender(), this.notifyListeners(`projectionUpdate`, s2)), Za.value && _c.calculatedProjections++;
    }
    hide() {
      this.isVisible = false;
    }
    show() {
      this.isVisible = true;
    }
    scheduleRender(e3 = true) {
      if (this.options.visualElement?.scheduleRender(), e3) {
        let e4 = this.getStack();
        e4 && e4.scheduleRender();
      }
      this.resumingFrom && !this.resumingFrom.instance && (this.resumingFrom = void 0);
    }
    createProjectionDeltas() {
      this.prevProjectionDelta = no(), this.projectionDelta = no(), this.projectionDeltaWithTransform = no();
    }
    setAnimationOrigin(e3, t3 = false, n3) {
      let r3 = this.snapshot, i3 = r3 ? r3.latestValues : {}, a2 = { ...this.latestValues }, o2 = no();
      (!this.relativeParent || !this.relativeParent.options.layoutRoot) && (this.relativeTarget = this.relativeTargetOrigin = void 0), this.attemptToResolveRelativeTarget = !t3;
      let s2 = io(), c2 = (r3 ? r3.source : void 0) !== (this.layout ? this.layout.source : void 0), l2 = this.getStack(), u2 = !l2 || l2.members.length <= 1, d2 = !!(c2 && !u2 && this.options.crossfade === true && !this.path.some(Hc));
      this.animationProgress = 0;
      let f2, p2 = n3?.interpolateProjection(e3);
      this.mixTargetDelta = (t4) => {
        let n4 = t4 / 1e3, r4 = p2?.(n4);
        r4 ? (o2.x.translate = r4.x, o2.x.scale = P(e3.x.scale, 1, n4), o2.x.origin = e3.x.origin, o2.x.originPoint = e3.x.originPoint, o2.y.translate = r4.y, o2.y.scale = P(e3.y.scale, 1, n4), o2.y.origin = e3.y.origin, o2.y.originPoint = e3.y.originPoint) : (zc(o2.x, e3.x, n4), zc(o2.y, e3.y, n4)), this.setTargetDelta(o2), this.relativeTarget && this.relativeTargetOrigin && this.layout && this.relativeParent && this.relativeParent.layout && (Rs(s2, this.layout.layoutBox, this.relativeParent.layout.layoutBox, this.options.layoutAnchor || void 0), Vc(this.relativeTarget, this.relativeTargetOrigin, s2, n4), f2 && Js(this.relativeTarget, f2) && (this.isProjectionDirty = false), f2 ||= io(), Es(f2, this.relativeTarget)), c2 && (this.animationValues = a2, ic(a2, i3, this.latestValues, n4, d2, u2)), r4 && r4.rotate !== void 0 && (this.animationValues ||= a2, this.animationValues.pathRotation = r4.rotate), this.root.scheduleUpdateProjection(), this.scheduleRender(), this.animationProgress = n4;
      }, this.mixTargetDelta(this.options.layoutRoot ? 1e3 : 0);
    }
    startAnimation(e3) {
      this.notifyListeners(`animationStart`), this.currentAnimation?.stop(), this.resumingFrom?.currentAnimation?.stop(), this.pendingAnimation &&= (vt(this.pendingAnimation), void 0), this.pendingAnimation = A.update(() => {
        gc.hasAnimatedSinceResize = true, this.motionValue ||= _i(0), this.motionValue.jump(0, false), this.currentAnimation = lc(this.motionValue, [0, 1e3], { ...e3, velocity: 0, isSync: true, onUpdate: (t3) => {
          this.mixTargetDelta(t3), e3.onUpdate && e3.onUpdate(t3);
        }, onComplete: () => {
          e3.onComplete && e3.onComplete(), this.completeAnimation();
        } }), this.resumingFrom && (this.resumingFrom.currentAnimation = this.currentAnimation), this.pendingAnimation = void 0;
      });
    }
    completeAnimation() {
      this.resumingFrom && (this.resumingFrom.currentAnimation = void 0, this.resumingFrom.preserveOpacity = void 0);
      let e3 = this.getStack();
      e3 && e3.exitAnimationComplete(), this.resumingFrom = this.currentAnimation = this.animationValues = void 0, this.notifyListeners(`animationComplete`);
    }
    finishAnimation() {
      this.currentAnimation && (this.mixTargetDelta && this.mixTargetDelta(yc), this.currentAnimation.stop()), this.completeAnimation();
    }
    applyTransformsToTarget() {
      let e3 = this.getLead(), { targetWithTransforms: t3, target: n3, layout: r3, latestValues: i3 } = e3;
      if (!(!t3 || !n3 || !r3)) {
        if (this !== e3 && this.layout && r3 && Jc(this.options.animationType, this.layout.layoutBox, r3.layoutBox)) {
          n3 = this.target || io();
          let t4 = B(this.layout.layoutBox.x);
          n3.x.min = e3.target.x.min, n3.x.max = n3.x.min + t4;
          let r4 = B(this.layout.layoutBox.y);
          n3.y.min = e3.target.y.min, n3.y.max = n3.y.min + r4;
        }
        Es(t3, n3), Uo(t3, i3), Ps(this.projectionDeltaWithTransform, this.layoutCorrected, t3, i3);
      }
    }
    registerSharedNode(e3, t3) {
      this.sharedNodes.has(e3) || this.sharedNodes.set(e3, new hc()), this.sharedNodes.get(e3).add(t3);
      let n3 = t3.options.initialPromotionConfig;
      t3.promote({ transition: n3 ? n3.transition : void 0, preserveFollowOpacity: n3 && n3.shouldPreserveFollowOpacity ? n3.shouldPreserveFollowOpacity(t3) : void 0 });
    }
    isLead() {
      let e3 = this.getStack();
      return !e3 || e3.lead === this;
    }
    getLead() {
      let { layoutId: e3 } = this.options;
      return e3 && this.getStack()?.lead || this;
    }
    getPrevLead() {
      let { layoutId: e3 } = this.options;
      return e3 ? this.getStack()?.prevLead : void 0;
    }
    getStack() {
      let { layoutId: e3 } = this.options;
      if (e3) return this.root.sharedNodes.get(e3);
    }
    promote({ needsReset: e3, transition: t3, preserveFollowOpacity: n3 } = {}) {
      let r3 = this.getStack();
      r3 && r3.promote(this, n3), e3 && (this.projectionDelta = void 0, this.needsReset = true), t3 && this.setOptions({ transition: t3 });
    }
    relegate() {
      let e3 = this.getStack();
      return e3 ? e3.relegate(this) : false;
    }
    resetSkewAndRotation() {
      let { visualElement: e3 } = this.options;
      if (!e3) return;
      let t3 = false, { latestValues: n3 } = e3;
      if ((n3.z || n3.rotate || n3.rotateX || n3.rotateY || n3.rotateZ || n3.skewX || n3.skewY) && (t3 = true), !t3) return;
      let r3 = {};
      n3.z && xc(`z`, e3, r3, this.animationValues);
      for (let t4 = 0; t4 < vc.length; t4++) xc(`rotate${vc[t4]}`, e3, r3, this.animationValues), xc(`skew${vc[t4]}`, e3, r3, this.animationValues);
      e3.render();
      for (let t4 in r3) e3.setStaticValue(t4, r3[t4]), this.animationValues && (this.animationValues[t4] = r3[t4]);
      e3.scheduleRender();
    }
    applyProjectionStyles(e3, t3) {
      if (!this.instance || this.isSVG) return;
      if (!this.isVisible) {
        e3.visibility = `hidden`;
        return;
      }
      let n3 = this.getTransformTemplate();
      if (this.needsReset) {
        this.needsReset = false, e3.visibility = ``, e3.opacity = ``, e3.pointerEvents = mc(t3?.pointerEvents) || ``, e3.transform = n3 ? n3(this.latestValues, ``) : `none`;
        return;
      }
      let r3 = this.getLead();
      if (!this.projectionDelta || !this.layout || !r3.target) {
        this.options.layoutId && (e3.opacity = this.latestValues.opacity === void 0 ? 1 : this.latestValues.opacity, e3.pointerEvents = mc(t3?.pointerEvents) || ``), this.hasProjected && !Ao(this.latestValues) && (e3.transform = n3 ? n3({}, ``) : `none`, this.hasProjected = false);
        return;
      }
      e3.visibility = ``;
      let i3 = r3.animationValues || r3.latestValues;
      this.applyTransformsToTarget();
      let a2 = ec(this.projectionDeltaWithTransform, this.treeScale, i3);
      n3 && (a2 = n3(i3, a2)), e3.transform = a2;
      let { x: o2, y: s2 } = this.projectionDelta;
      e3.transformOrigin = `${o2.origin * 100}% ${s2.origin * 100}% 0`, r3.animationValues ? e3.opacity = r3 === this ? i3.opacity ?? this.latestValues.opacity ?? 1 : this.preserveOpacity ? this.latestValues.opacity : i3.opacityExit : e3.opacity = r3 === this ? i3.opacity === void 0 ? `` : i3.opacity : i3.opacityExit === void 0 ? 0 : i3.opacityExit;
      for (let t4 in es) {
        if (i3[t4] === void 0) continue;
        let { correct: n4, applyTo: o3, isCSSVariable: s3 } = es[t4], c2 = a2 === `none` ? i3[t4] : n4(i3[t4], r3);
        if (o3) {
          let t5 = o3.length;
          for (let n5 = 0; n5 < t5; n5++) e3[o3[n5]] = c2;
        } else s3 ? this.options.visualElement.renderState.vars[t4] = c2 : e3[t4] = c2;
      }
      this.options.layoutId && (e3.pointerEvents = r3 === this ? mc(t3?.pointerEvents) || `` : `none`);
    }
    clearSnapshot() {
      this.resumeFrom = this.snapshot = void 0;
    }
    resetTree() {
      this.root.nodes.forEach((e3) => e3.currentAnimation?.stop()), this.root.nodes.forEach(kc), this.root.sharedNodes.clear();
    }
  };
}
function wc(e2) {
  e2.updateLayout();
}
function Tc(e2) {
  let t2 = e2.resumeFrom?.snapshot || e2.snapshot;
  if (e2.isLead() && e2.layout && t2 && e2.hasListeners(`didUpdate`)) {
    let { layoutBox: n2, measuredBox: r2 } = e2.layout, { animationType: i2 } = e2.options, a2 = t2.source !== e2.layout.source;
    if (i2 === `size`) $s((e3) => {
      let r3 = a2 ? t2.measuredBox[e3] : t2.layoutBox[e3], i3 = B(r3);
      r3.min = n2[e3].min, r3.max = r3.min + i3;
    });
    else if (i2 === `x` || i2 === `y`) {
      let e3 = i2 === `x` ? `y` : `x`;
      Ts(a2 ? t2.measuredBox[e3] : t2.layoutBox[e3], n2[e3]);
    } else Jc(i2, t2.layoutBox, n2) && $s((r3) => {
      let i3 = a2 ? t2.measuredBox[r3] : t2.layoutBox[r3], o3 = B(n2[r3]);
      i3.max = i3.min + o3, e2.relativeTarget && !e2.currentAnimation && (e2.isProjectionDirty = true, e2.relativeTarget[r3].max = e2.relativeTarget[r3].min + o3);
    });
    let o2 = no();
    Ps(o2, n2, t2.layoutBox);
    let s2 = no();
    a2 ? Ps(s2, e2.applyTransform(r2, true), t2.measuredBox) : Ps(s2, n2, t2.layoutBox);
    let c2 = !Ks(o2), l2 = false;
    if (!e2.resumeFrom) {
      let r3 = e2.getClosestProjectingParent();
      if (r3 && !r3.resumeFrom) {
        let { snapshot: i3, layout: a3 } = r3;
        if (i3 && a3) {
          let o3 = e2.options.layoutAnchor || void 0, s3 = io();
          Rs(s3, t2.layoutBox, i3.layoutBox, o3);
          let c3 = io();
          Rs(c3, n2, a3.layoutBox, o3), Xs(s3, c3) || (l2 = true), r3.options.layoutRoot && (e2.relativeTarget = c3, e2.relativeTargetOrigin = s3, e2.relativeParent = r3);
        }
      }
    }
    e2.notifyListeners(`didUpdate`, { layout: n2, snapshot: t2, delta: s2, layoutDelta: o2, hasLayoutChanged: c2, hasRelativeLayoutChanged: l2 });
  } else if (e2.isLead()) {
    let { onExitComplete: t3 } = e2.options;
    t3 && t3();
  }
  e2.options.transition = void 0;
}
function Ec(e2) {
  Za.value && _c.nodes++, e2.parent && (e2.isProjecting() || (e2.isProjectionDirty = e2.parent.isProjectionDirty), e2.isSharedProjectionDirty ||= !!(e2.isProjectionDirty || e2.parent.isProjectionDirty || e2.parent.isSharedProjectionDirty), e2.isTransformDirty ||= e2.parent.isTransformDirty);
}
function Dc(e2) {
  e2.isProjectionDirty = e2.isSharedProjectionDirty = e2.isTransformDirty = false;
}
function Oc(e2) {
  e2.clearSnapshot();
}
function kc(e2) {
  e2.clearMeasurements();
}
function Ac(e2) {
  e2.isLayoutDirty = true, e2.updateLayout();
}
function jc(e2) {
  e2.isLayoutDirty = false;
}
function Mc(e2) {
  e2.isAnimationBlocked && e2.layout && !e2.isLayoutDirty && (e2.snapshot = e2.layout, e2.isLayoutDirty = true);
}
function Nc(e2) {
  let { visualElement: t2 } = e2.options;
  t2 && t2.getProps().onBeforeLayoutMeasure && t2.notify(`BeforeLayoutMeasure`), e2.resetTransform();
}
function Pc(e2) {
  e2.finishAnimation(), e2.targetDelta = e2.relativeTarget = e2.target = void 0, e2.isProjectionDirty = true;
}
function Fc(e2) {
  e2.resolveTargetDelta();
}
function Ic(e2) {
  e2.calcProjection();
}
function Lc(e2) {
  e2.resetSkewAndRotation();
}
function Rc(e2) {
  e2.removeLeadSnapshot();
}
function zc(e2, t2, n2) {
  e2.translate = P(t2.translate, 0, n2), e2.scale = P(t2.scale, 1, n2), e2.origin = t2.origin, e2.originPoint = t2.originPoint;
}
function Bc(e2, t2, n2, r2) {
  e2.min = P(t2.min, n2.min, r2), e2.max = P(t2.max, n2.max, r2);
}
function Vc(e2, t2, n2, r2) {
  Bc(e2.x, t2.x, n2.x, r2), Bc(e2.y, t2.y, n2.y, r2);
}
function Hc(e2) {
  return e2.animationValues && e2.animationValues.opacityExit !== void 0;
}
var Uc = { duration: 0.45, ease: [0.4, 0, 0.1, 1] }, Wc = (e2) => typeof navigator < `u` && navigator.userAgent && navigator.userAgent.toLowerCase().includes(e2), Gc = Wc(`applewebkit/`) && !Wc(`chrome/`) ? Math.round : k;
function Kc(e2) {
  e2.min = Gc(e2.min), e2.max = Gc(e2.max);
}
function qc(e2) {
  Kc(e2.x), Kc(e2.y);
}
function Jc(e2, t2, n2) {
  return e2 === `position` || e2 === `preserve-aspect` && !Ms(Zs(t2), Zs(n2), 0.2);
}
function Yc(e2) {
  return e2 !== e2.root && e2.scroll?.wasRoot;
}
var Xc = Cc({ attachResizeListener: (e2, t2) => uc(e2, `resize`, t2), measureScroll: () => ({ x: document.documentElement.scrollLeft || document.body?.scrollLeft || 0, y: document.documentElement.scrollTop || document.body?.scrollTop || 0 }), checkIsScrollRoot: () => true }), Zc = { current: void 0 }, Qc = Cc({ measureScroll: (e2) => ({ x: e2.scrollLeft, y: e2.scrollTop }), defaultParent: () => {
  if (!Zc.current) {
    let e2 = new Xc({});
    e2.mount(window), e2.setOptions({ layoutScroll: true }), Zc.current = e2;
  }
  return Zc.current;
}, resetTransform: (e2, t2) => {
  e2.style.transform = t2 === void 0 ? `none` : t2;
}, checkIsScrollRoot: (e2) => window.getComputedStyle(e2).position === `fixed` }), $c = (0, O.createContext)({ transformPagePoint: (e2) => e2, isStatic: false, reducedMotion: `never` });
function el(e2, t2) {
  if (typeof e2 == `function`) return e2(t2);
  e2 != null && (e2.current = t2);
}
function tl(...e2) {
  return (t2) => {
    let n2 = false, r2 = e2.map((e3) => {
      let r3 = el(e3, t2);
      return !n2 && typeof r3 == `function` && (n2 = true), r3;
    });
    if (n2) return () => {
      for (let t3 = 0; t3 < r2.length; t3++) {
        let n3 = r2[t3];
        typeof n3 == `function` ? n3() : el(e2[t3], null);
      }
    };
  };
}
function nl(...e2) {
  return O.useCallback(tl(...e2), e2);
}
var V = De(), rl = class extends O.Component {
  getSnapshotBeforeUpdate(e2) {
    let t2 = this.props.childRef.current;
    if (_a(t2) && e2.isPresent && !this.props.isPresent && this.props.pop !== false) {
      let e3 = t2.offsetParent, n2 = _a(e3) && e3.offsetWidth || 0, r2 = _a(e3) && e3.offsetHeight || 0, i2 = getComputedStyle(t2), a2 = this.props.sizeRef.current;
      a2.height = parseFloat(i2.height), a2.width = parseFloat(i2.width), a2.top = t2.offsetTop, a2.left = t2.offsetLeft, a2.right = n2 - a2.width - a2.left, a2.bottom = r2 - a2.height - a2.top, a2.direction = i2.direction;
    }
    return null;
  }
  componentDidUpdate() {
  }
  render() {
    return this.props.children;
  }
};
function il({ children: e2, isPresent: t2, anchorX: n2, anchorY: r2, root: i2, pop: a2 }) {
  let o2 = (0, O.useId)(), s2 = (0, O.useRef)(null), c2 = (0, O.useRef)({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, direction: `ltr` }), { nonce: l2 } = (0, O.useContext)($c), u2 = nl(s2, e2.props?.ref ?? e2?.ref);
  return (0, O.useInsertionEffect)(() => {
    let { width: e3, height: u3, top: d2, left: f2, right: p2, bottom: m2, direction: h2 } = c2.current;
    if (t2 || a2 === false || !s2.current || !e3 || !u3) return;
    let g2 = h2 === `rtl`, _2 = n2 === `left` ? g2 ? `right: ${p2}` : `left: ${f2}` : g2 ? `left: ${f2}` : `right: ${p2}`, v2 = r2 === `bottom` ? `bottom: ${m2}` : `top: ${d2}`;
    s2.current.dataset.motionPopId = o2;
    let y2 = document.createElement(`style`);
    l2 && (y2.nonce = l2);
    let b2 = i2 ?? document.head;
    return b2.appendChild(y2), y2.sheet && y2.sheet.insertRule(`
          [data-motion-pop-id="${o2}"] {
            position: absolute !important;
            width: ${e3}px !important;
            height: ${u3}px !important;
            ${_2}px !important;
            ${v2}px !important;
          }
        `), () => {
      s2.current?.removeAttribute(`data-motion-pop-id`), b2.contains(y2) && b2.removeChild(y2);
    };
  }, [t2]), (0, V.jsx)(rl, { isPresent: t2, childRef: s2, sizeRef: c2, pop: a2, children: a2 === false ? e2 : O.cloneElement(e2, { ref: u2 }) });
}
var al = ({ children: e2, initial: t2, isPresent: n2, onExitComplete: r2, custom: i2, presenceAffectsLayout: a2, mode: o2, anchorX: s2, anchorY: c2, root: l2 }) => {
  let u2 = ke(ol), d2 = (0, O.useId)(), f2 = (0, O.useRef)(n2), p2 = (0, O.useRef)(r2);
  Ae(() => {
    f2.current = n2, p2.current = r2;
  });
  let m2 = true, h2 = (0, O.useMemo)(() => (m2 = false, { id: d2, initial: t2, isPresent: n2, custom: i2, onExitComplete: (e3) => {
    u2.set(e3, true);
    for (let e4 of u2.values()) if (!e4) return;
    r2 && r2();
  }, register: (e3) => (u2.set(e3, false), () => {
    u2.delete(e3), !f2.current && !u2.size && p2.current?.();
  }) }), [n2, u2, r2]);
  return a2 && m2 && (h2 = { ...h2 }), (0, O.useMemo)(() => {
    u2.forEach((e3, t3) => u2.set(t3, false));
  }, [n2]), O.useEffect(() => {
    !n2 && !u2.size && r2 && r2();
  }, [n2]), e2 = (0, V.jsx)(il, { pop: o2 === `popLayout`, isPresent: n2, anchorX: s2, anchorY: c2, root: l2, children: e2 }), (0, V.jsx)(je.Provider, { value: h2, children: e2 });
};
function ol() {
  return /* @__PURE__ */ new Map();
}
function sl(e2 = true) {
  let t2 = (0, O.useContext)(je);
  if (t2 === null) return [true, null];
  let { isPresent: n2, onExitComplete: r2, register: i2 } = t2, a2 = (0, O.useId)();
  (0, O.useEffect)(() => {
    if (e2) return i2(a2);
  }, [e2]);
  let o2 = (0, O.useCallback)(() => e2 && r2 && r2(a2), [a2, r2, e2]);
  return !n2 && r2 ? [false, o2] : [true];
}
var cl = (e2) => e2.key || ``;
function ll(e2) {
  let t2 = [];
  return O.Children.forEach(e2, (e3) => {
    (0, O.isValidElement)(e3) && t2.push(e3);
  }), t2;
}
var ul = ({ children: e2, custom: t2, initial: n2 = true, onExitComplete: r2, presenceAffectsLayout: i2 = true, mode: a2 = `sync`, propagate: o2 = false, anchorX: s2 = `left`, anchorY: c2 = `top`, root: l2 }) => {
  let [u2, d2] = sl(o2), f2 = (0, O.useMemo)(() => ll(e2), [e2]), p2 = o2 && !u2 ? [] : f2.map(cl), m2 = (0, O.useRef)(true), h2 = (0, O.useRef)(f2), g2 = ke(() => /* @__PURE__ */ new Map()), _2 = (0, O.useRef)(/* @__PURE__ */ new Set()), [v2, y2] = (0, O.useState)(f2), [b2, x2] = (0, O.useState)(f2);
  Ae(() => {
    m2.current = false, h2.current = f2;
    for (let e3 = 0; e3 < b2.length; e3++) {
      let t3 = cl(b2[e3]);
      p2.includes(t3) ? (g2.delete(t3), _2.current.delete(t3)) : g2.get(t3) !== true && g2.set(t3, false);
    }
  }, [b2, p2.length, p2.join(`-`)]);
  let S2 = [];
  if (f2 !== v2) {
    let e3 = [...f2];
    for (let t3 = 0; t3 < b2.length; t3++) {
      let n3 = b2[t3], r3 = cl(n3);
      p2.includes(r3) || (e3.splice(t3, 0, n3), S2.push(n3));
    }
    return a2 === `wait` && S2.length && (e3 = S2), x2(ll(e3)), y2(f2), null;
  }
  let { forceRender: C2 } = (0, O.useContext)(Oe);
  return (0, V.jsx)(V.Fragment, { children: b2.map((e3) => {
    let v3 = cl(e3), y3 = o2 && !u2 ? false : f2 === b2 || p2.includes(v3);
    return (0, V.jsx)(al, { isPresent: y3, initial: !m2.current || n2 ? void 0 : false, custom: t2, presenceAffectsLayout: i2, mode: a2, root: l2, onExitComplete: y3 ? void 0 : () => {
      if (_2.current.has(v3)) return;
      if (g2.has(v3)) _2.current.add(v3), g2.set(v3, true);
      else return;
      let e4 = true;
      g2.forEach((t3) => {
        t3 || (e4 = false);
      }), e4 && (C2?.(), x2(h2.current), o2 && d2?.(), r2 && r2());
    }, anchorX: s2, anchorY: c2, children: e3 }, v3);
  }) });
}, dl = (0, O.createContext)({ strict: false }), fl = { animation: [`animate`, `variants`, `whileHover`, `whileTap`, `exit`, `whileInView`, `whileFocus`, `whileDrag`], exit: [`exit`], drag: [`drag`, `dragControls`], focus: [`whileFocus`], hover: [`whileHover`, `onHoverStart`, `onHoverEnd`], tap: [`whileTap`, `onTap`, `onTapStart`, `onTapCancel`], pan: [`onPan`, `onPanStart`, `onPanSessionStart`, `onPanEnd`], inView: [`whileInView`, `onViewportEnter`, `onViewportLeave`], layout: [`layout`, `layoutId`] }, pl = false;
function ml() {
  if (pl) return;
  let e2 = {};
  for (let t2 in fl) e2[t2] = { isEnabled: (e3) => fl[t2].some((t3) => !!e3[t3]) };
  bo(e2), pl = true;
}
function hl() {
  return ml(), xo();
}
function gl(e2) {
  let t2 = hl();
  for (let n2 in e2) t2[n2] = { ...t2[n2], ...e2[n2] };
  bo(t2);
}
var _l = new Set(`animate.exit.variants.initial.style.values.variants.transition.transformTemplate.custom.inherit.onBeforeLayoutMeasure.onAnimationStart.onAnimationComplete.onUpdate.onDragStart.onDrag.onDragEnd.onMeasureDragConstraints.onDirectionLock.onDragTransitionEnd._dragX._dragY.onHoverStart.onHoverEnd.onViewportEnter.onViewportLeave.globalTapTarget.propagate.ignoreStrict.viewport`.split(`.`));
function vl(e2) {
  return e2.startsWith(`while`) || e2.startsWith(`drag`) && e2 !== `draggable` || e2.startsWith(`layout`) || e2.startsWith(`onTap`) || e2.startsWith(`onPan`) || e2.startsWith(`onLayout`) || _l.has(e2);
}
var yl = c({ default: () => bl }), bl, xl = o((() => {
  throw bl = {}, Error(`Could not resolve "@emotion/is-prop-valid" imported by "framer-motion". Is it installed?`);
})), Sl = (e2) => !vl(e2);
function Cl(e2) {
  typeof e2 == `function` && (Sl = (t2) => t2.startsWith(`on`) ? !vl(t2) : e2(t2));
}
try {
  Cl((xl(), d(yl)).default);
} catch {
}
function wl(e2, t2, n2) {
  let r2 = {};
  for (let i2 in e2) i2 === `values` && typeof e2.values == `object` || Ri(e2[i2]) || (Sl(i2) || n2 === true && vl(i2) || !t2 && !vl(i2) || e2.draggable && i2.startsWith(`onDrag`)) && (r2[i2] = e2[i2]);
  return r2;
}
function Tl({ children: e2, isValidProp: t2, ...n2 }) {
  t2 && Cl(t2);
  let r2 = (0, O.useContext)($c);
  n2 = { ...r2, ...n2 }, n2.transition = vi(n2.transition, r2.transition), n2.isStatic = ke(() => n2.isStatic);
  let i2 = (0, O.useMemo)(() => n2, [JSON.stringify(n2.transition), n2.transformPagePoint, n2.reducedMotion, n2.skipAnimations]);
  return (0, V.jsx)($c.Provider, { value: i2, children: e2 });
}
var El = (0, O.createContext)({});
function Dl(e2, t2) {
  if (uo(e2)) {
    let { initial: t3, animate: n2 } = e2;
    return { initial: t3 === false || so(t3) ? t3 : void 0, animate: so(n2) ? n2 : void 0 };
  }
  return e2.inherit === false ? {} : t2;
}
function Ol(e2) {
  let { initial: t2, animate: n2 } = Dl(e2, (0, O.useContext)(El));
  return (0, O.useMemo)(() => ({ initial: t2, animate: n2 }), [kl(t2), kl(n2)]);
}
function kl(e2) {
  return Array.isArray(e2) ? e2.join(` `) : e2;
}
var Al = () => ({ style: {}, transform: {}, transformOrigin: {}, vars: {} });
function jl(e2, t2, n2) {
  for (let r2 in t2) !Ri(t2[r2]) && !ts(r2, n2) && (e2[r2] = t2[r2]);
}
function H({ transformTemplate: e2 }, t2) {
  return (0, O.useMemo)(() => {
    let n2 = Al();
    return Yo(n2, t2, e2), Object.assign({}, n2.vars, n2.style);
  }, [t2]);
}
function U(e2, t2) {
  let n2 = e2.style || {}, r2 = {};
  return jl(r2, n2, e2), Object.assign(r2, H(e2, t2)), r2;
}
function W(e2, t2) {
  let n2 = {}, r2 = U(e2, t2);
  return e2.drag && e2.dragListener !== false && (n2.draggable = false, r2.userSelect = r2.WebkitUserSelect = r2.WebkitTouchCallout = `none`, r2.touchAction = e2.drag === true ? `none` : `pan-${e2.drag === `x` ? `y` : `x`}`), e2.tabIndex === void 0 && (e2.onTap || e2.onTapStart || e2.whileTap) && (n2.tabIndex = 0), n2.style = r2, n2;
}
var G = () => ({ ...Al(), attrs: {} });
function K(e2, t2, n2, r2) {
  let i2 = (0, O.useMemo)(() => {
    let n3 = G();
    return ls(n3, t2, ds(r2), e2.transformTemplate, e2.style), { ...n3.attrs, style: { ...n3.style } };
  }, [t2]);
  if (e2.style) {
    let t3 = {};
    jl(t3, e2.style, e2), i2.style = { ...t3, ...i2.style };
  }
  return i2;
}
var Ml = [`animate`, `circle`, `defs`, `desc`, `ellipse`, `g`, `image`, `line`, `filter`, `marker`, `mask`, `metadata`, `path`, `pattern`, `polygon`, `polyline`, `rect`, `stop`, `switch`, `symbol`, `svg`, `text`, `tspan`, `use`, `view`];
function Nl(e2) {
  return typeof e2 != `string` || e2.includes(`-`) ? false : !!(Ml.indexOf(e2) > -1 || /[A-Z]/u.test(e2));
}
function Pl(e2, t2, n2, { latestValues: r2 }, i2, a2 = false, o2) {
  let s2 = (o2 ?? Nl(e2) ? K : W)(t2, r2, i2, e2), c2 = wl(t2, typeof e2 == `string`, a2), l2 = e2 === O.Fragment ? {} : { ...c2, ...s2, ref: n2 }, { children: u2 } = t2, d2 = (0, O.useMemo)(() => Ri(u2) ? u2.get() : u2, [u2]);
  return (0, O.createElement)(e2, { ...l2, children: d2 });
}
function Fl({ scrapeMotionValuesFromProps: e2, createRenderState: t2 }, n2, r2, i2) {
  return { latestValues: Il(n2, r2, i2, e2), renderState: t2() };
}
function Il(e2, t2, n2, r2) {
  let i2 = {}, a2 = r2(e2, {});
  for (let e3 in a2) i2[e3] = mc(a2[e3]);
  let { initial: o2, animate: s2 } = e2, c2 = uo(e2), l2 = fo(e2);
  t2 && l2 && !c2 && e2.inherit !== false && (o2 === void 0 && (o2 = t2.initial), s2 === void 0 && (s2 = t2.animate));
  let u2 = n2 ? n2.initial === false : false;
  u2 ||= o2 === false;
  let d2 = u2 ? s2 : o2;
  if (d2 && typeof d2 != `boolean` && !oo(d2)) {
    let t3 = Array.isArray(d2) ? d2 : [d2];
    for (let n3 = 0; n3 < t3.length; n3++) {
      let r3 = Mi(e2, t3[n3]);
      if (r3) {
        let { transitionEnd: e3, transition: t4, ...n4 } = r3;
        for (let e4 in n4) {
          let t5 = n4[e4];
          if (Array.isArray(t5)) {
            let e5 = u2 ? t5.length - 1 : 0;
            t5 = t5[e5];
          }
          t5 !== null && (i2[e4] = t5);
        }
        for (let t5 in e3) i2[t5] = e3[t5];
      }
    }
  }
  return i2;
}
var Ll = (e2) => (t2, n2) => {
  let r2 = (0, O.useContext)(El), i2 = (0, O.useContext)(je), a2 = () => Fl(e2, t2, r2, i2);
  return n2 ? a2() : ke(a2);
}, Rl = Ll({ scrapeMotionValuesFromProps: ns, createRenderState: Al }), zl = Ll({ scrapeMotionValuesFromProps: ps, createRenderState: G }), Bl = Symbol.for(`motionComponentSymbol`);
function Vl(e2, t2, n2) {
  let r2 = (0, O.useRef)(n2);
  (0, O.useInsertionEffect)(() => {
    r2.current = n2;
  });
  let i2 = (0, O.useRef)(null);
  return (0, O.useCallback)((n3) => {
    n3 && e2.onMount?.(n3), t2 && (n3 ? t2.mount(n3) : t2.unmount());
    let a2 = r2.current;
    if (typeof a2 == `function`) if (n3) {
      let e3 = a2(n3);
      typeof e3 == `function` && (i2.current = e3);
    } else i2.current ? (i2.current(), i2.current = null) : a2(n3);
    else a2 && (a2.current = n3);
  }, [t2]);
}
var Hl = (0, O.createContext)({});
function Ul(e2) {
  return e2 && typeof e2 == `object` && Object.prototype.hasOwnProperty.call(e2, `current`);
}
function Wl(e2, t2, n2, r2, i2, a2) {
  let { visualElement: o2 } = (0, O.useContext)(El), s2 = (0, O.useContext)(dl), c2 = (0, O.useContext)(je), l2 = (0, O.useContext)($c), u2 = l2.reducedMotion, d2 = l2.skipAnimations, f2 = (0, O.useRef)(null), p2 = (0, O.useRef)(false);
  r2 ||= s2.renderer, !f2.current && r2 && (f2.current = r2(e2, { visualState: t2, parent: o2, props: n2, presenceContext: c2, blockInitialAnimation: c2 ? c2.initial === false : false, reducedMotionConfig: u2, skipAnimations: d2, isSVG: a2 }), p2.current && f2.current && (f2.current.manuallyAnimateOnMount = true));
  let m2 = f2.current, h2 = (0, O.useContext)(Hl);
  m2 && !m2.projection && i2 && (m2.type === `html` || m2.type === `svg`) && Gl(f2.current, n2, i2, h2);
  let g2 = (0, O.useRef)(false);
  (0, O.useInsertionEffect)(() => {
    m2 && g2.current && m2.update(n2, c2);
  });
  let _2 = n2[Hi], v2 = (0, O.useRef)(!!_2 && typeof window < `u` && !window.MotionHandoffIsComplete?.(_2) && window.MotionHasOptimisedAnimation?.(_2));
  return Ae(() => {
    p2.current = true, m2 && (g2.current = true, window.MotionIsMounted = true, m2.updateFeatures(), m2.scheduleRenderMicrotask(), v2.current && m2.animationState && m2.animationState.animateChanges());
  }), (0, O.useEffect)(() => {
    m2 && (!v2.current && m2.animationState && m2.animationState.animateChanges(), v2.current &&= (queueMicrotask(() => {
      window.MotionHandoffMarkAsComplete?.(_2);
    }), false), m2.enteringChildren = void 0);
  }), m2;
}
function Gl(e2, t2, n2, r2) {
  let { layoutId: i2, layout: a2, drag: o2, dragConstraints: s2, layoutScroll: c2, layoutRoot: l2, layoutAnchor: u2, layoutCrossfade: d2 } = t2;
  e2.projection = new n2(e2.latestValues, t2[`data-framer-portal-id`] ? void 0 : Kl(e2.parent)), e2.projection.setOptions({ layoutId: i2, layout: a2, alwaysMeasureLayout: !!o2 || s2 && Ul(s2), visualElement: e2, animationType: typeof a2 == `string` ? a2 : `both`, initialPromotionConfig: r2, crossfade: d2, layoutScroll: c2, layoutRoot: l2, layoutAnchor: u2 });
}
function Kl(e2) {
  if (e2) return e2.options.allowProjection === false ? Kl(e2.parent) : e2.projection;
}
function ql(e2, { forwardMotionProps: t2 = false, type: n2 } = {}, r2, i2) {
  r2 && gl(r2);
  let a2 = n2 ? n2 === `svg` : Nl(e2), o2 = a2 ? zl : Rl;
  function s2(n3, s3) {
    let c3, l2 = { ...(0, O.useContext)($c), ...n3, layoutId: Jl(n3) }, { isStatic: u2 } = l2, d2 = Ol(n3), f2 = o2(n3, u2);
    if (!u2 && typeof window < `u`) {
      Yl(l2, r2);
      let t3 = Xl(l2);
      c3 = t3.MeasureLayout, d2.visualElement = Wl(e2, f2, l2, i2, t3.ProjectionNode, a2);
    }
    return (0, V.jsxs)(El.Provider, { value: d2, children: [c3 && d2.visualElement ? (0, V.jsx)(c3, { visualElement: d2.visualElement, ...l2 }) : null, Pl(e2, n3, Vl(f2, d2.visualElement, s3), f2, u2, t2, a2)] });
  }
  s2.displayName = `motion.${typeof e2 == `string` ? e2 : `create(${e2.displayName ?? e2.name ?? ``})`}`;
  let c2 = (0, O.forwardRef)(s2);
  return c2[Bl] = e2, c2;
}
function Jl({ layoutId: e2 }) {
  let t2 = (0, O.useContext)(Oe).id;
  return t2 && e2 !== void 0 ? t2 + `-` + e2 : e2;
}
function Yl(e2, t2) {
  (0, O.useContext)(dl).strict;
}
function Xl(e2) {
  let { drag: t2, layout: n2 } = hl();
  if (!t2 && !n2) return {};
  let r2 = { ...t2, ...n2 };
  return { MeasureLayout: t2?.isEnabled(e2) || n2?.isEnabled(e2) ? r2.MeasureLayout : void 0, ProjectionNode: r2.ProjectionNode };
}
function Zl(e2, t2) {
  if (typeof Proxy > `u`) return ql;
  let n2 = /* @__PURE__ */ new Map(), r2 = (n3, r3) => ql(n3, r3, e2, t2);
  return new Proxy((e3, t3) => r2(e3, t3), { get: (i2, a2) => a2 === `create` ? r2 : (n2.has(a2) || n2.set(a2, ql(a2, void 0, e2, t2)), n2.get(a2)) });
}
var Ql = (e2, t2) => t2.isSVG ?? Nl(e2) ? new ms(t2) : new is(t2, { allowProjection: e2 !== O.Fragment }), $l = class extends wo {
  constructor(e2) {
    super(e2), e2.animationState ||= xs(e2);
  }
  updateAnimationControlsSubscription() {
    let { animate: e2 } = this.node.getProps();
    oo(e2) && (this.unmountControls = e2.subscribe(this.node));
  }
  mount() {
    this.updateAnimationControlsSubscription();
  }
  update() {
    let { animate: e2 } = this.node.getProps(), { animate: t2 } = this.node.prevProps || {};
    e2 !== t2 && this.updateAnimationControlsSubscription();
  }
  unmount() {
    this.node.animationState.reset(), this.unmountControls?.();
  }
}, eu = 0, tu = { animation: { Feature: $l }, exit: { Feature: class extends wo {
  constructor() {
    super(...arguments), this.id = eu++, this.isExitComplete = false;
  }
  update() {
    if (!this.node.presenceContext) return;
    let { isPresent: e2, onExitComplete: t2 } = this.node.presenceContext, { isPresent: n2 } = this.node.prevPresenceContext || {};
    if (!this.node.animationState || e2 === n2) return;
    if (e2 && n2 === false) {
      if (this.isExitComplete) {
        let { initial: e3, custom: t3 } = this.node.getProps();
        if (typeof e3 == `string` || typeof e3 == `object` && e3 && !Array.isArray(e3)) {
          let n3 = I(this.node, e3, t3);
          if (n3) {
            let { transition: e4, transitionEnd: t4, ...r3 } = n3;
            for (let e5 in r3) this.node.getValue(e5)?.jump(r3[e5]);
          }
        }
        this.node.animationState.reset(), this.node.animationState.animateChanges();
      } else this.node.animationState.setActive(`exit`, false);
      this.isExitComplete = false;
      return;
    }
    let r2 = this.node.animationState.setActive(`exit`, !e2);
    t2 && !e2 && r2.then(() => {
      this.isExitComplete = true, t2(this.id);
    });
  }
  mount() {
    let { register: e2, onExitComplete: t2 } = this.node.presenceContext || {};
    t2 && t2(this.id), e2 && (this.unmount = e2(this.id));
  }
  unmount() {
  }
} } };
function nu(e2) {
  return { point: { x: e2.pageX, y: e2.pageY } };
}
var ru = (e2) => (t2) => Da(t2) && e2(t2, nu(t2));
function iu(e2, t2, n2, r2) {
  return uc(e2, t2, ru(n2), r2);
}
var au = ({ current: e2 }) => e2 ? e2.ownerDocument.defaultView : null, ou = (e2, t2) => Math.abs(e2 - t2);
function su(e2, t2) {
  let n2 = ou(e2.x, t2.x), r2 = ou(e2.y, t2.y);
  return Math.sqrt(n2 ** 2 + r2 ** 2);
}
var cu = /* @__PURE__ */ new Set([`auto`, `scroll`]), lu = class {
  constructor(e2, t2, { transformPagePoint: n2, contextWindow: r2 = window, dragSnapToOrigin: i2 = false, distanceThreshold: a2 = 3, element: o2 } = {}) {
    if (this.startEvent = null, this.lastMoveEvent = null, this.lastMoveEventInfo = null, this.lastRawMoveEventInfo = null, this.handlers = {}, this.contextWindow = window, this.scrollPositions = /* @__PURE__ */ new Map(), this.removeScrollListeners = null, this.onElementScroll = (e3) => {
      this.handleScroll(e3.target);
    }, this.onWindowScroll = () => {
      this.handleScroll(window);
    }, this.updatePoint = () => {
      if (!(this.lastMoveEvent && this.lastMoveEventInfo)) return;
      this.lastRawMoveEventInfo && (this.lastMoveEventInfo = uu(this.lastRawMoveEventInfo, this.transformPagePoint));
      let e3 = fu(this.lastMoveEventInfo, this.history), t3 = this.startEvent !== null, n3 = su(e3.offset, { x: 0, y: 0 }) >= this.distanceThreshold;
      if (!t3 && !n3) return;
      let { point: r3 } = e3, { timestamp: i3 } = j;
      this.history.push({ ...r3, timestamp: i3 });
      let { onStart: a3, onMove: o3 } = this.handlers;
      t3 || (a3 && a3(this.lastMoveEvent, e3), this.startEvent = this.lastMoveEvent), o3 && o3(this.lastMoveEvent, e3);
    }, this.handlePointerMove = (e3, t3) => {
      this.lastMoveEvent = e3, this.lastRawMoveEventInfo = t3, this.lastMoveEventInfo = uu(t3, this.transformPagePoint), A.update(this.updatePoint, true);
    }, this.handlePointerUp = (e3, t3) => {
      this.end();
      let { onEnd: n3, onSessionEnd: r3, resumeAnimation: i3 } = this.handlers;
      if ((this.dragSnapToOrigin || !this.startEvent) && i3 && i3(), !(this.lastMoveEvent && this.lastMoveEventInfo)) return;
      let a3 = fu(e3.type === `pointercancel` ? this.lastMoveEventInfo : uu(t3, this.transformPagePoint), this.history);
      this.startEvent && n3 && n3(e3, a3), r3 && r3(e3, a3);
    }, !Da(e2)) return;
    this.dragSnapToOrigin = i2, this.handlers = t2, this.transformPagePoint = n2, this.distanceThreshold = a2, this.contextWindow = r2 || window;
    let s2 = uu(nu(e2), this.transformPagePoint), { point: c2 } = s2, { timestamp: l2 } = j;
    this.history = [{ ...c2, timestamp: l2 }];
    let { onSessionStart: u2 } = t2;
    u2 && u2(e2, fu(s2, this.history));
    let d2 = { passive: true, capture: true };
    this.removeListeners = Be(iu(this.contextWindow, `pointermove`, this.handlePointerMove, d2), iu(this.contextWindow, `pointerup`, this.handlePointerUp, d2), iu(this.contextWindow, `pointercancel`, this.handlePointerUp, d2)), o2 && this.startScrollTracking(o2);
  }
  startScrollTracking(e2) {
    let t2 = e2.parentElement;
    for (; t2; ) {
      let e3 = getComputedStyle(t2);
      (cu.has(e3.overflowX) || cu.has(e3.overflowY)) && this.scrollPositions.set(t2, { x: t2.scrollLeft, y: t2.scrollTop }), t2 = t2.parentElement;
    }
    this.scrollPositions.set(window, { x: window.scrollX, y: window.scrollY }), window.addEventListener(`scroll`, this.onElementScroll, { capture: true }), window.addEventListener(`scroll`, this.onWindowScroll), this.removeScrollListeners = () => {
      window.removeEventListener(`scroll`, this.onElementScroll, { capture: true }), window.removeEventListener(`scroll`, this.onWindowScroll);
    };
  }
  handleScroll(e2) {
    let t2 = this.scrollPositions.get(e2);
    if (!t2) return;
    let n2 = e2 === window, r2 = n2 ? { x: window.scrollX, y: window.scrollY } : { x: e2.scrollLeft, y: e2.scrollTop }, i2 = { x: r2.x - t2.x, y: r2.y - t2.y };
    i2.x === 0 && i2.y === 0 || (n2 ? this.lastMoveEventInfo && (this.lastMoveEventInfo.point.x += i2.x, this.lastMoveEventInfo.point.y += i2.y) : this.history.length > 0 && (this.history[0].x -= i2.x, this.history[0].y -= i2.y), this.scrollPositions.set(e2, r2), A.update(this.updatePoint, true));
  }
  updateHandlers(e2) {
    this.handlers = e2;
  }
  end() {
    this.removeListeners && this.removeListeners(), this.removeScrollListeners && this.removeScrollListeners(), this.scrollPositions.clear(), vt(this.updatePoint);
  }
};
function uu(e2, t2) {
  return t2 ? { point: t2(e2.point) } : e2;
}
function du(e2, t2) {
  return { x: e2.x - t2.x, y: e2.y - t2.y };
}
function fu({ point: e2 }, t2) {
  return { point: e2, delta: du(e2, mu(t2)), offset: du(e2, pu(t2)), velocity: hu(t2, 0.1) };
}
function pu(e2) {
  return e2[0];
}
function mu(e2) {
  return e2[e2.length - 1];
}
function hu(e2, t2) {
  if (e2.length < 2) return { x: 0, y: 0 };
  let n2 = e2.length - 1, r2 = null, i2 = mu(e2);
  for (; n2 >= 0 && (r2 = e2[n2], !(i2.timestamp - r2.timestamp > Ue(t2))); ) n2--;
  if (!r2) return { x: 0, y: 0 };
  r2 === e2[0] && e2.length > 2 && i2.timestamp - r2.timestamp > Ue(t2) * 2 && (r2 = e2[1]);
  let a2 = We(i2.timestamp - r2.timestamp);
  if (a2 === 0) return { x: 0, y: 0 };
  let o2 = { x: (i2.x - r2.x) / a2, y: (i2.y - r2.y) / a2 };
  return o2.x === 1 / 0 && (o2.x = 0), o2.y === 1 / 0 && (o2.y = 0), o2;
}
function gu(e2, { min: t2, max: n2 }, r2) {
  return t2 !== void 0 && e2 < t2 ? e2 = r2 ? P(t2, e2, r2.min) : Math.max(e2, t2) : n2 !== void 0 && e2 > n2 && (e2 = r2 ? P(n2, e2, r2.max) : Math.min(e2, n2)), e2;
}
function _u(e2, t2, n2) {
  return { min: t2 === void 0 ? void 0 : e2.min + t2, max: n2 === void 0 ? void 0 : e2.max + n2 - (e2.max - e2.min) };
}
function vu(e2, { top: t2, left: n2, bottom: r2, right: i2 }) {
  return { x: _u(e2.x, n2, i2), y: _u(e2.y, t2, r2) };
}
function yu(e2, t2) {
  let n2 = t2.min - e2.min, r2 = t2.max - e2.max;
  return t2.max - t2.min < e2.max - e2.min && ([n2, r2] = [r2, n2]), { min: n2, max: r2 };
}
function bu(e2, t2) {
  return { x: yu(e2.x, t2.x), y: yu(e2.y, t2.y) };
}
function xu(e2, t2) {
  let n2 = 0.5, r2 = B(e2), i2 = B(t2);
  return i2 > r2 ? n2 = Ve(t2.min, t2.max - r2, e2.min) : r2 > i2 && (n2 = Ve(e2.min, e2.max - i2, t2.min)), Pe(0, 1, n2);
}
function Su(e2, t2) {
  let n2 = {};
  return t2.min !== void 0 && (n2.min = t2.min - e2.min), t2.max !== void 0 && (n2.max = t2.max - e2.min), n2;
}
var Cu = 0.35;
function wu(e2 = Cu) {
  return e2 === false ? e2 = 0 : e2 === true && (e2 = Cu), { x: Tu(e2, `left`, `right`), y: Tu(e2, `top`, `bottom`) };
}
function Tu(e2, t2, n2) {
  return { min: Eu(e2, t2), max: Eu(e2, n2) };
}
function Eu(e2, t2) {
  return typeof e2 == `number` ? e2 : e2[t2] || 0;
}
var Du = /* @__PURE__ */ new WeakMap(), Ou = class {
  constructor(e2) {
    this.openDragLock = null, this.isDragging = false, this.currentDirection = null, this.originPoint = { x: 0, y: 0 }, this.constraints = false, this.hasMutatedConstraints = false, this.elastic = io(), this.latestPointerEvent = null, this.latestPanInfo = null, this.visualElement = e2;
  }
  start(e2, { snapToCursor: t2 = false, distanceThreshold: n2 } = {}) {
    let { presenceContext: r2 } = this.visualElement;
    if (r2 && r2.isPresent === false) return;
    let i2 = (e3) => {
      t2 && this.snapToCursor(nu(e3).point), this.stopAnimation();
    }, a2 = (e3, t3) => {
      let { drag: n3, dragPropagation: r3, onDragStart: i3 } = this.getProps();
      if (n3 && !r3 && (this.openDragLock && this.openDragLock(), this.openDragLock = Sa(n3), !this.openDragLock)) return;
      this.latestPointerEvent = e3, this.latestPanInfo = t3, this.isDragging = true, this.currentDirection = null, this.resolveConstraints(), this.visualElement.projection && (this.visualElement.projection.isAnimationBlocked = true, this.visualElement.projection.target = void 0), $s((e4) => {
        let t4 = this.getAxisMotionValue(e4).get() || 0;
        if (Gt.test(t4)) {
          let { projection: n4 } = this.visualElement;
          if (n4 && n4.layout) {
            let r4 = n4.layout.layoutBox[e4];
            r4 && (t4 = B(r4) * (parseFloat(t4) / 100));
          }
        }
        this.originPoint[e4] = t4;
      }), i3 && A.update(() => i3(e3, t3), false, true), Bi(this.visualElement, `transform`);
      let { animationState: a3 } = this.visualElement;
      a3 && a3.setActive(`whileDrag`, true);
    }, o2 = (e3, t3) => {
      this.latestPointerEvent = e3, this.latestPanInfo = t3;
      let { dragPropagation: n3, dragDirectionLock: r3, onDirectionLock: i3, onDrag: a3 } = this.getProps();
      if (!n3 && !this.openDragLock) return;
      let { offset: o3 } = t3;
      if (r3 && this.currentDirection === null) {
        this.currentDirection = Mu(o3), this.currentDirection !== null && i3 && i3(this.currentDirection);
        return;
      }
      this.updateAxis(`x`, t3.point, o3), this.updateAxis(`y`, t3.point, o3), this.visualElement.render(), a3 && A.update(() => a3(e3, t3), false, true);
    }, s2 = (e3, t3) => {
      this.latestPointerEvent = e3, this.latestPanInfo = t3, this.stop(e3, t3), this.latestPointerEvent = null, this.latestPanInfo = null;
    }, c2 = () => {
      let { dragSnapToOrigin: e3 } = this.getProps();
      (e3 || this.constraints) && this.startAnimation({ x: 0, y: 0 });
    }, { dragSnapToOrigin: l2 } = this.getProps();
    this.panSession = new lu(e2, { onSessionStart: i2, onStart: a2, onMove: o2, onSessionEnd: s2, resumeAnimation: c2 }, { transformPagePoint: this.visualElement.getTransformPagePoint(), dragSnapToOrigin: l2, distanceThreshold: n2, contextWindow: au(this.visualElement), element: this.visualElement.current });
  }
  stop(e2, t2) {
    let n2 = e2 || this.latestPointerEvent, r2 = t2 || this.latestPanInfo, i2 = this.isDragging;
    if (this.cancel(), !i2 || !r2 || !n2) return;
    let { velocity: a2 } = r2;
    this.startAnimation(a2);
    let { onDragEnd: o2 } = this.getProps();
    o2 && A.postRender(() => o2(n2, r2));
  }
  cancel() {
    this.isDragging = false;
    let { projection: e2, animationState: t2 } = this.visualElement;
    e2 && (e2.isAnimationBlocked = false), this.endPanSession();
    let { dragPropagation: n2 } = this.getProps();
    !n2 && this.openDragLock && (this.openDragLock(), this.openDragLock = null), t2 && t2.setActive(`whileDrag`, false);
  }
  endPanSession() {
    this.panSession && this.panSession.end(), this.panSession = void 0;
  }
  updateAxis(e2, t2, n2) {
    let { drag: r2 } = this.getProps();
    if (!n2 || !ju(e2, r2, this.currentDirection)) return;
    let i2 = this.getAxisMotionValue(e2), a2 = this.originPoint[e2] + n2[e2];
    this.constraints && this.constraints[e2] && (a2 = gu(a2, this.constraints[e2], this.elastic[e2])), i2.set(a2);
  }
  resolveConstraints() {
    let { dragConstraints: e2, dragElastic: t2 } = this.getProps(), n2 = this.visualElement.projection && !this.visualElement.projection.layout ? this.visualElement.projection.measure(false) : this.visualElement.projection?.layout, r2 = this.constraints;
    e2 && Ul(e2) ? this.constraints ||= this.resolveRefConstraints() : e2 && n2 ? this.constraints = vu(n2.layoutBox, e2) : this.constraints = false, this.elastic = wu(t2), r2 !== this.constraints && !Ul(e2) && n2 && this.constraints && !this.hasMutatedConstraints && $s((e3) => {
      this.constraints !== false && this.getAxisMotionValue(e3) && (this.constraints[e3] = Su(n2.layoutBox[e3], this.constraints[e3]));
    });
  }
  resolveRefConstraints() {
    let { dragConstraints: e2, onMeasureDragConstraints: t2 } = this.getProps();
    if (!e2 || !Ul(e2)) return false;
    let n2 = e2.current, { projection: r2 } = this.visualElement;
    if (!r2 || !r2.layout) return false;
    r2.root && (r2.root.scroll = void 0, r2.root.updateScroll());
    let i2 = Go(n2, r2.root, this.visualElement.getTransformPagePoint()), a2 = bu(r2.layout.layoutBox, i2);
    if (t2) {
      let e3 = t2(Eo(a2));
      this.hasMutatedConstraints = !!e3, e3 && (a2 = To(e3));
    }
    return a2;
  }
  startAnimation(e2) {
    let { drag: t2, dragMomentum: n2, dragElastic: r2, dragTransition: i2, dragSnapToOrigin: a2, onDragTransitionEnd: o2 } = this.getProps(), s2 = this.constraints || {}, c2 = $s((o3) => {
      if (!ju(o3, t2, this.currentDirection)) return;
      let c3 = s2 && s2[o3] || {};
      (a2 === true || a2 === o3) && (c3 = { min: 0, max: 0 });
      let l2 = r2 ? 200 : 1e6, u2 = r2 ? 40 : 1e7, d2 = { type: `inertia`, velocity: n2 ? e2[o3] : 0, bounceStiffness: l2, bounceDamping: u2, timeConstant: 750, restDelta: 1, restSpeed: 10, ...i2, ...c3 };
      return this.startAxisValueAnimation(o3, d2);
    });
    return Promise.all(c2).then(o2);
  }
  startAxisValueAnimation(e2, t2) {
    let n2 = this.getAxisMotionValue(e2);
    return Bi(this.visualElement, e2), n2.start(Di(e2, n2, 0, t2, this.visualElement, false));
  }
  stopAnimation() {
    $s((e2) => this.getAxisMotionValue(e2).stop());
  }
  getAxisMotionValue(e2) {
    let t2 = `_drag${e2.toUpperCase()}`;
    return this.visualElement.getProps()[t2] || this.visualElement.getValue(e2, this.visualElement.latestValues[e2] ?? 0);
  }
  snapToCursor(e2) {
    $s((t2) => {
      let { drag: n2 } = this.getProps();
      if (!ju(t2, n2, this.currentDirection)) return;
      let { projection: r2 } = this.visualElement, i2 = this.getAxisMotionValue(t2);
      if (r2 && r2.layout) {
        let { min: n3, max: a2 } = r2.layout.layoutBox[t2], o2 = i2.get() || 0;
        i2.set(e2[t2] - P(n3, a2, 0.5) + o2);
      }
    });
  }
  scalePositionWithinConstraints() {
    if (!this.visualElement.current) return;
    let { drag: e2, dragConstraints: t2 } = this.getProps(), { projection: n2 } = this.visualElement;
    if (!Ul(t2) || !n2 || !this.constraints) return;
    this.stopAnimation();
    let r2 = { x: 0, y: 0 };
    $s((e3) => {
      let t3 = this.getAxisMotionValue(e3);
      if (t3 && this.constraints !== false) {
        let n3 = t3.get();
        r2[e3] = xu({ min: n3, max: n3 }, this.constraints[e3]);
      }
    });
    let { transformTemplate: i2 } = this.visualElement.getProps();
    this.visualElement.current.style.transform = i2 ? i2({}, ``) : `none`, n2.root && n2.root.updateScroll(), n2.updateLayout(), this.constraints = false, this.resolveConstraints(), $s((t3) => {
      if (!ju(t3, e2, null)) return;
      let n3 = this.getAxisMotionValue(t3), { min: i3, max: a2 } = this.constraints[t3];
      n3.set(P(i3, a2, r2[t3]));
    }), this.visualElement.render();
  }
  addListeners() {
    if (!this.visualElement.current) return;
    Du.set(this.visualElement, this);
    let e2 = this.visualElement.current, t2 = iu(e2, `pointerdown`, (t3) => {
      let { drag: n3, dragListener: r3 = true } = this.getProps(), i3 = t3.target, a3 = i3 !== e2 && ja(i3);
      n3 && r3 && !a3 && this.start(t3);
    }), n2, r2 = () => {
      let { dragConstraints: t3 } = this.getProps();
      Ul(t3) && t3.current && (this.constraints = this.resolveRefConstraints(), n2 ||= Au(e2, t3.current, () => this.scalePositionWithinConstraints()));
    }, { projection: i2 } = this.visualElement, a2 = i2.addEventListener(`measure`, r2);
    i2 && !i2.layout && (i2.root && i2.root.updateScroll(), i2.updateLayout()), A.read(r2);
    let o2 = uc(window, `resize`, () => this.scalePositionWithinConstraints()), s2 = i2.addEventListener(`didUpdate`, (({ delta: e3, hasLayoutChanged: t3 }) => {
      this.isDragging && t3 && ($s((t4) => {
        let n3 = this.getAxisMotionValue(t4);
        n3 && (this.originPoint[t4] += e3[t4].translate, n3.set(n3.get() + e3[t4].translate));
      }), this.visualElement.render());
    }));
    return () => {
      o2(), t2(), a2(), s2 && s2(), n2 && n2();
    };
  }
  getProps() {
    let e2 = this.visualElement.getProps(), { drag: t2 = false, dragDirectionLock: n2 = false, dragPropagation: r2 = false, dragConstraints: i2 = false, dragElastic: a2 = Cu, dragMomentum: o2 = true } = e2;
    return { ...e2, drag: t2, dragDirectionLock: n2, dragPropagation: r2, dragConstraints: i2, dragElastic: a2, dragMomentum: o2 };
  }
};
function ku(e2) {
  let t2 = true;
  return () => {
    if (t2) {
      t2 = false;
      return;
    }
    e2();
  };
}
function Au(e2, t2, n2) {
  let r2 = Xa(e2, ku(n2)), i2 = Xa(t2, ku(n2));
  return () => {
    r2(), i2();
  };
}
function ju(e2, t2, n2) {
  return (t2 === true || t2 === e2) && (n2 === null || n2 === e2);
}
function Mu(e2, t2 = 10) {
  let n2 = null;
  return Math.abs(e2.y) > t2 ? n2 = `y` : Math.abs(e2.x) > t2 && (n2 = `x`), n2;
}
var Nu = class extends wo {
  constructor(e2) {
    super(e2), this.removeGroupControls = k, this.removeListeners = k, this.controls = new Ou(e2);
  }
  mount() {
    let { dragControls: e2 } = this.node.getProps();
    e2 && (this.removeGroupControls = e2.subscribe(this.controls)), this.removeListeners = this.controls.addListeners() || k;
  }
  update() {
    let { dragControls: e2 } = this.node.getProps(), { dragControls: t2 } = this.node.prevProps || {};
    e2 !== t2 && (this.removeGroupControls(), e2 && (this.removeGroupControls = e2.subscribe(this.controls)));
  }
  unmount() {
    this.removeGroupControls(), this.removeListeners(), this.controls.isDragging || this.controls.endPanSession();
  }
}, Pu = (e2) => (t2, n2) => {
  e2 && A.update(() => e2(t2, n2), false, true);
}, Fu = class extends wo {
  constructor() {
    super(...arguments), this.removePointerDownListener = k;
  }
  onPointerDown(e2) {
    this.session = new lu(e2, this.createPanHandlers(), { transformPagePoint: this.node.getTransformPagePoint(), contextWindow: au(this.node) });
  }
  createPanHandlers() {
    let { onPanSessionStart: e2, onPanStart: t2, onPan: n2, onPanEnd: r2 } = this.node.getProps();
    return { onSessionStart: Pu(e2), onStart: Pu(t2), onMove: Pu(n2), onEnd: (e3, t3) => {
      delete this.session, r2 && A.postRender(() => r2(e3, t3));
    } };
  }
  mount() {
    this.removePointerDownListener = iu(this.node.current, `pointerdown`, (e2) => this.onPointerDown(e2));
  }
  update() {
    this.session && this.session.updateHandlers(this.createPanHandlers());
  }
  unmount() {
    this.removePointerDownListener(), this.session && this.session.end();
  }
}, q = false, Iu = class extends O.Component {
  componentDidMount() {
    let { visualElement: e2, layoutGroup: t2, switchLayoutGroup: n2, layoutId: r2 } = this.props, { projection: i2 } = e2;
    i2 && (t2.group && t2.group.add(i2), n2 && n2.register && r2 && n2.register(i2), q && i2.root.didUpdate(), i2.addEventListener(`animationComplete`, () => {
      this.safeToRemove();
    }), i2.setOptions({ ...i2.options, layoutDependency: this.props.layoutDependency, onExitComplete: () => this.safeToRemove() })), gc.hasEverUpdated = true;
  }
  getSnapshotBeforeUpdate(e2) {
    let { layoutDependency: t2, visualElement: n2, drag: r2, isPresent: i2 } = this.props, { projection: a2 } = n2;
    return a2 ? (a2.isPresent = i2, e2.layoutDependency !== t2 && a2.setOptions({ ...a2.options, layoutDependency: t2 }), q = true, r2 || e2.layoutDependency !== t2 || t2 === void 0 || e2.isPresent !== i2 ? a2.willUpdate() : this.safeToRemove(), e2.isPresent !== i2 && (i2 ? a2.promote() : a2.relegate() || A.postRender(() => {
      let e3 = a2.getStack();
      (!e3 || !e3.members.length) && this.safeToRemove();
    })), null) : null;
  }
  componentDidUpdate() {
    let { visualElement: e2, layoutAnchor: t2 } = this.props, { projection: n2 } = e2;
    n2 && (n2.options.layoutAnchor = t2, n2.root.didUpdate(), va.postRender(() => {
      !n2.currentAnimation && n2.isLead() && this.safeToRemove();
    }));
  }
  componentWillUnmount() {
    let { visualElement: e2, layoutGroup: t2, switchLayoutGroup: n2 } = this.props, { projection: r2 } = e2;
    q = true, r2 && (r2.scheduleCheckAfterUnmount(), t2 && t2.group && t2.group.remove(r2), n2 && n2.deregister && n2.deregister(r2));
  }
  safeToRemove() {
    let { safeToRemove: e2 } = this.props;
    e2 && e2();
  }
  render() {
    return null;
  }
};
function Lu(e2) {
  let [t2, n2] = sl(), r2 = (0, O.useContext)(Oe);
  return (0, V.jsx)(Iu, { ...e2, layoutGroup: r2, switchLayoutGroup: (0, O.useContext)(Hl), isPresent: t2, safeToRemove: n2 });
}
var Ru = { pan: { Feature: Fu }, drag: { Feature: Nu, ProjectionNode: Qc, MeasureLayout: Lu } };
function zu(e2, t2, n2) {
  let { props: r2 } = e2;
  e2.animationState && r2.whileHover && e2.animationState.setActive(`whileHover`, n2 === `Start`);
  let i2 = r2[`onHover` + n2];
  i2 && A.postRender(() => i2(t2, nu(t2)));
}
var Bu = class extends wo {
  mount() {
    let { current: e2 } = this.node;
    e2 && (this.unmount = Ta(e2, (e3, t2) => (zu(this.node, t2, `Start`), (e4) => zu(this.node, e4, `End`))));
  }
  unmount() {
  }
}, Vu = class extends wo {
  constructor() {
    super(...arguments), this.isActive = false;
  }
  onFocus() {
    let e2 = false;
    try {
      e2 = this.node.current.matches(`:focus-visible`);
    } catch {
      e2 = true;
    }
    !e2 || !this.node.animationState || (this.node.animationState.setActive(`whileFocus`, true), this.isActive = true);
  }
  onBlur() {
    !this.isActive || !this.node.animationState || (this.node.animationState.setActive(`whileFocus`, false), this.isActive = false);
  }
  mount() {
    this.unmount = Be(uc(this.node.current, `focus`, () => this.onFocus()), uc(this.node.current, `blur`, () => this.onBlur()));
  }
  unmount() {
  }
};
function Hu(e2, t2, n2) {
  let { props: r2 } = e2;
  if (e2.current instanceof HTMLButtonElement && e2.current.disabled) return;
  e2.animationState && r2.whileTap && e2.animationState.setActive(`whileTap`, n2 === `Start`);
  let i2 = r2[`onTap` + (n2 === `End` ? `` : n2)];
  i2 && A.postRender(() => i2(t2, nu(t2)));
}
var Uu = class extends wo {
  mount() {
    let { current: e2 } = this.node;
    if (!e2) return;
    let { globalTapTarget: t2, propagate: n2 } = this.node.props;
    this.unmount = Ra(e2, (e3, t3) => (Hu(this.node, t3, `Start`), (e4, { success: t4 }) => Hu(this.node, e4, t4 ? `End` : `Cancel`)), { useGlobalTarget: t2, stopPropagation: n2?.tap === false });
  }
  unmount() {
  }
}, Wu = /* @__PURE__ */ new WeakMap(), Gu = /* @__PURE__ */ new WeakMap(), Ku = (e2) => {
  let t2 = Wu.get(e2.target);
  t2 && t2(e2);
}, qu = (e2) => {
  e2.forEach(Ku);
};
function Ju({ root: e2, ...t2 }) {
  let n2 = e2 || document;
  Gu.has(n2) || Gu.set(n2, {});
  let r2 = Gu.get(n2), i2 = JSON.stringify(t2);
  return r2[i2] || (r2[i2] = new IntersectionObserver(qu, { root: e2, ...t2 })), r2[i2];
}
function Yu(e2, t2, n2) {
  let r2 = Ju(t2);
  return Wu.set(e2, n2), r2.observe(e2), () => {
    Wu.delete(e2), r2.unobserve(e2);
  };
}
var Xu = { some: 0, all: 1 }, Zu = class extends wo {
  constructor() {
    super(...arguments), this.hasEnteredView = false, this.isInView = false;
  }
  startObserver() {
    this.stopObserver?.();
    let { viewport: e2 = {} } = this.node.getProps(), { root: t2, margin: n2, amount: r2 = `some`, once: i2 } = e2, a2 = { root: t2 ? t2.current : void 0, rootMargin: n2, threshold: typeof r2 == `number` ? r2 : Xu[r2] }, o2 = (e3) => {
      let { isIntersecting: t3 } = e3;
      if (this.isInView === t3 || (this.isInView = t3, i2 && !t3 && this.hasEnteredView)) return;
      t3 && (this.hasEnteredView = true), this.node.animationState && this.node.animationState.setActive(`whileInView`, t3);
      let { onViewportEnter: n3, onViewportLeave: r3 } = this.node.getProps(), a3 = t3 ? n3 : r3;
      a3 && a3(e3);
    };
    this.stopObserver = Yu(this.node.current, a2, o2);
  }
  mount() {
    this.startObserver();
  }
  update() {
    if (typeof IntersectionObserver > `u`) return;
    let { props: e2, prevProps: t2 } = this.node;
    [`amount`, `margin`, `root`].some(Qu(e2, t2)) && this.startObserver();
  }
  unmount() {
    this.stopObserver?.(), this.hasEnteredView = false, this.isInView = false;
  }
};
function Qu({ viewport: e2 = {} }, { viewport: t2 = {} } = {}) {
  return (n2) => e2[n2] !== t2[n2];
}
var $u = { inView: { Feature: Zu }, tap: { Feature: Uu }, focus: { Feature: Vu }, hover: { Feature: Bu } }, ed = { layout: { ProjectionNode: Qc, MeasureLayout: Lu } }, td = Zl({ ...tu, ...$u, ...Ru, ...ed }, Ql);
function nd() {
  !ho.current && _o();
  let [e2] = (0, O.useState)(mo.current);
  return e2;
}
var rd = (e2) => e2.replace(/([a-z0-9])([A-Z])/g, `$1-$2`).toLowerCase(), id = (e2) => e2.replace(/^([A-Z])|[\s-_]+(\w)/g, (e3, t2, n2) => n2 ? n2.toUpperCase() : t2.toLowerCase()), ad = (e2) => {
  let t2 = id(e2);
  return t2.charAt(0).toUpperCase() + t2.slice(1);
}, od = (...e2) => e2.filter((e3, t2, n2) => !!e3 && e3.trim() !== `` && n2.indexOf(e3) === t2).join(` `).trim(), sd = (e2) => {
  for (let t2 in e2) if (t2.startsWith(`aria-`) || t2 === `role` || t2 === `title`) return true;
}, cd = { xmlns: `http://www.w3.org/2000/svg`, width: 24, height: 24, viewBox: `0 0 24 24`, fill: `none`, stroke: `currentColor`, strokeWidth: 2, strokeLinecap: `round`, strokeLinejoin: `round` }, ld = (0, O.forwardRef)(({ color: e2 = `currentColor`, size: t2 = 24, strokeWidth: n2 = 2, absoluteStrokeWidth: r2, className: i2 = ``, children: a2, iconNode: o2, ...s2 }, c2) => (0, O.createElement)(`svg`, { ref: c2, ...cd, width: t2, height: t2, stroke: e2, strokeWidth: r2 ? Number(n2) * 24 / Number(t2) : n2, className: od(`lucide`, i2), ...!a2 && !sd(s2) && { "aria-hidden": `true` }, ...s2 }, [...o2.map(([e3, t3]) => (0, O.createElement)(e3, t3)), ...Array.isArray(a2) ? a2 : [a2]])), J = (e2, t2) => {
  let n2 = (0, O.forwardRef)(({ className: n3, ...r2 }, i2) => (0, O.createElement)(ld, { ref: i2, iconNode: t2, className: od(`lucide-${rd(ad(e2))}`, `lucide-${e2}`, n3), ...r2 }));
  return n2.displayName = ad(e2), n2;
}, Y = J(`activity`, [[`path`, { d: `M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2`, key: `169zse` }]]), ud = J(`check`, [[`path`, { d: `M20 6 9 17l-5-5`, key: `1gmf2c` }]]), dd = J(`circle-help`, [[`circle`, { cx: `12`, cy: `12`, r: `10`, key: `1mglay` }], [`path`, { d: `M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3`, key: `1u773s` }], [`path`, { d: `M12 17h.01`, key: `p32p05` }]]), fd = J(`clipboard`, [[`rect`, { width: `8`, height: `4`, x: `8`, y: `2`, rx: `1`, ry: `1`, key: `tgr4d6` }], [`path`, { d: `M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2`, key: `116196` }]]), pd = J(`clock-3`, [[`circle`, { cx: `12`, cy: `12`, r: `10`, key: `1mglay` }], [`polyline`, { points: `12 6 12 12 16.5 12`, key: `1aq6pp` }]]), md = J(`download`, [[`path`, { d: `M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`, key: `ih7n3h` }], [`polyline`, { points: `7 10 12 15 17 10`, key: `2ggqvy` }], [`line`, { x1: `12`, x2: `12`, y1: `15`, y2: `3`, key: `1vk2je` }]]), hd = J(`earth`, [[`path`, { d: `M21.54 15H17a2 2 0 0 0-2 2v4.54`, key: `1djwo0` }], [`path`, { d: `M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17`, key: `1tzkfa` }], [`path`, { d: `M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05`, key: `14pb5j` }], [`circle`, { cx: `12`, cy: `12`, r: `10`, key: `1mglay` }]]), _d = J(`gauge`, [[`path`, { d: `m12 14 4-4`, key: `9kzdfg` }], [`path`, { d: `M3.34 19a10 10 0 1 1 17.32 0`, key: `19p75a` }]]), vd = J(`key-round`, [[`path`, { d: `M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z`, key: `1s6t7t` }], [`circle`, { cx: `16.5`, cy: `7.5`, r: `.5`, fill: `currentColor`, key: `w0ekpg` }]]), yd = J(`layout-dashboard`, [[`rect`, { width: `7`, height: `9`, x: `3`, y: `3`, rx: `1`, key: `10lvy0` }], [`rect`, { width: `7`, height: `5`, x: `14`, y: `3`, rx: `1`, key: `16une8` }], [`rect`, { width: `7`, height: `9`, x: `14`, y: `12`, rx: `1`, key: `1hutg5` }], [`rect`, { width: `7`, height: `5`, x: `3`, y: `16`, rx: `1`, key: `ldoo1y` }]]), bd = J(`list-restart`, [[`path`, { d: `M21 6H3`, key: `1jwq7v` }], [`path`, { d: `M7 12H3`, key: `13ou7f` }], [`path`, { d: `M7 18H3`, key: `1sijw9` }], [`path`, { d: `M12 18a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L11 14`, key: `qth677` }], [`path`, { d: `M11 10v4h4`, key: `172dkj` }]]), xd = J(`map-pin`, [[`path`, { d: `M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0`, key: `1r0f0z` }], [`circle`, { cx: `12`, cy: `10`, r: `3`, key: `ilqhr7` }]]), Sd = J(`maximize-2`, [[`polyline`, { points: `15 3 21 3 21 9`, key: `mznyad` }], [`polyline`, { points: `9 21 3 21 3 15`, key: `1avn1i` }], [`line`, { x1: `21`, x2: `14`, y1: `3`, y2: `10`, key: `ota7mn` }], [`line`, { x1: `3`, x2: `10`, y1: `21`, y2: `14`, key: `1atl0r` }]]), Cd = J(`minus`, [[`path`, { d: `M5 12h14`, key: `1ays0h` }]]), X = J(`network`, [[`rect`, { x: `16`, y: `16`, width: `6`, height: `6`, rx: `1`, key: `4q2zg0` }], [`rect`, { x: `2`, y: `16`, width: `6`, height: `6`, rx: `1`, key: `8cvhb9` }], [`rect`, { x: `9`, y: `2`, width: `6`, height: `6`, rx: `1`, key: `1egb70` }], [`path`, { d: `M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3`, key: `1jsf9p` }], [`path`, { d: `M12 12V8`, key: `2874zd` }]]), wd = J(`power`, [[`path`, { d: `M12 2v10`, key: `mnfbl` }], [`path`, { d: `M18.4 6.6a9 9 0 1 1-12.77.04`, key: `obofu9` }]]), Td = J(`radar`, [[`path`, { d: `M19.07 4.93A10 10 0 0 0 6.99 3.34`, key: `z3du51` }], [`path`, { d: `M4 6h.01`, key: `oypzma` }], [`path`, { d: `M2.29 9.62A10 10 0 1 0 21.31 8.35`, key: `qzzz0` }], [`path`, { d: `M16.24 7.76A6 6 0 1 0 8.23 16.67`, key: `1yjesh` }], [`path`, { d: `M12 18h.01`, key: `mhygvu` }], [`path`, { d: `M17.99 11.66A6 6 0 0 1 15.77 16.67`, key: `1u2y91` }], [`circle`, { cx: `12`, cy: `12`, r: `2`, key: `1c9p78` }], [`path`, { d: `m13.41 10.59 5.66-5.66`, key: `mhq4k0` }]]), Ed = J(`refresh-ccw`, [[`path`, { d: `M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`, key: `14sxne` }], [`path`, { d: `M3 3v5h5`, key: `1xhq8a` }], [`path`, { d: `M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16`, key: `1hlbsb` }], [`path`, { d: `M16 16h5v5`, key: `ccwih5` }]]), Dd = J(`send`, [[`path`, { d: `M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z`, key: `1ffxy3` }], [`path`, { d: `m21.854 2.147-10.94 10.939`, key: `12cjpa` }]]), Od = J(`settings`, [[`path`, { d: `M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z`, key: `1qme2f` }], [`circle`, { cx: `12`, cy: `12`, r: `3`, key: `1v7zrd` }]]), Ad = J(`shield-check`, [[`path`, { d: `M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z`, key: `oel41y` }], [`path`, { d: `m9 12 2 2 4-4`, key: `dzmm74` }]]), jd = J(`shield-off`, [[`path`, { d: `m2 2 20 20`, key: `1ooewy` }], [`path`, { d: `M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71`, key: `1jlk70` }], [`path`, { d: `M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264`, key: `18rp1v` }]]), Md = J(`star`, [[`path`, { d: `M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z`, key: `r04s7s` }]]), Nd = J(`triangle-alert`, [[`path`, { d: `m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3`, key: `wmoenq` }], [`path`, { d: `M12 9v4`, key: `juzpu7` }], [`path`, { d: `M12 17h.01`, key: `p32p05` }]]), Pd = J(`upload`, [[`path`, { d: `M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`, key: `ih7n3h` }], [`polyline`, { points: `17 8 12 3 7 8`, key: `t8dd8p` }], [`line`, { x1: `12`, x2: `12`, y1: `3`, y2: `15`, key: `widbto` }]]), Fd = J(`wrench`, [[`path`, { d: `M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z`, key: `cbrjhi` }]]), Id = J(`x`, [[`path`, { d: `M18 6 6 18`, key: `1bl5f8` }], [`path`, { d: `m6 6 12 12`, key: `d8bk6v` }]]), Ld = Te(), Rd = new TextDecoder(`utf-8`, { fatal: true });
function zd(e2) {
  let t2 = Uint8Array.from({ length: 256 }, (e3, t3) => t3), n2 = new TextDecoder(e2).decode(t2), r2 = /* @__PURE__ */ new Map();
  return Array.from(n2).forEach((e3, t3) => {
    r2.has(e3) || r2.set(e3, t3);
  }), r2;
}
var Bd = zd(`windows-1251`), Vd = zd(`windows-1252`);
function Hd(e2) {
  let t2 = e2.match(/[ÃÂÐÑ]|â(?:€|„|“|”|€™|€¦|†|‡|€¢)/g)?.length ?? 0, n2 = e2.match(/[РС][\u0400-\u04ff\u2010-\u203a]/g)?.length ?? 0, r2 = e2.match(/(?:рџ|Рџ|пё|в(?:Ђ|‚|„|…|†|‡|€|™|љ|њ|ў|ќ|­))/gu)?.length ?? 0;
  return t2 + n2 + r2;
}
function Ud(e2, t2) {
  let n2 = [];
  for (let r2 of e2) {
    let e3 = t2(r2);
    if (e3 == null) return null;
    n2.push(e3);
  }
  try {
    return Rd.decode(Uint8Array.from(n2));
  } catch {
    return null;
  }
}
function Wd(e2) {
  return Hd(e2) < 1 ? e2 : [Ud(e2, (e3) => {
    let t2 = e3.codePointAt(0);
    return t2 != null && t2 <= 255 ? t2 : null;
  }), Ud(e2, (e3) => Vd.get(e3) ?? null), Ud(e2, (e3) => Bd.get(e3) ?? null)].filter((e3) => !!e3).reduce((e3, t2) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(t2) ? e3 : Hd(t2) < Hd(e3) ? t2 : e3, e2);
}
function Gd(e2) {
  let t2 = e2;
  for (let e3 = 0; e3 < 3; e3 += 1) {
    let e4 = Wd(t2);
    if (e4 === t2 || Hd(e4) >= Hd(t2)) break;
    t2 = e4;
  }
  return t2;
}
function Kd(e2) {
  return Gd(e2).normalize(`NFC`).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\ufeff]/gu, ``).replace(/\s+/gu, ` `).trim();
}
function qd(e2) {
  return /egoistshieldcore|core service|named[- ]pipe|pipe.*unavailable|identity verification/i.test(e2) ? `core` : /access is denied|отказано в доступе|unauthorizedaccess|requires elevation|администратор/i.test(e2) ? `admin` : /не найден.*сетев|active.*interface|netipinterface|no matching/i.test(e2) || /\bno (?:connected |active )?(?:physical )?network interface(?: was)? (?:found|available)\b/i.test(e2) ? `no-interface` : /не подтверд|test-dnsaddressesapplied|serveraddresses/i.test(e2) || /\b(?:ipv4 |ipv6 )?dns(?: reset)? verification failed\b/i.test(e2) || /\bdns (?:reset |restore )?readback returned a different adapter set\b/i.test(e2) ? `verify` : `apply`;
}
function Jd(e2) {
  if (!e2.active) return false;
  if (e2.nativeManaged) return true;
  switch (e2.mode) {
    case `system-default`:
    case `manual-dns`:
    case `native-windows-encrypted-dns`:
      return true;
    case `system-doh`:
    case `gravityless-dns`:
      return e2.backgroundServiceRunning;
    default:
      return false;
  }
}
var Yd = `` + new URL(`egoist-shield-logo-Ch4DYhEY.png`, import.meta.url).href, Xd = { size: 18, strokeWidth: 1.75 };
var bf = 1.75, xf = { inline: 13, section: 14, nav: 16, tool: 15, tile: 20 }, Sf = new Map(Object.entries(Object.assign({ "./assets/flags/ae.svg": f, "./assets/flags/at.svg": p, "./assets/flags/be.svg": m, "./assets/flags/bg.svg": h, "./assets/flags/br.svg": g, "./assets/flags/bt.svg": _, "./assets/flags/ca.svg": v, "./assets/flags/ch.svg": y, "./assets/flags/cz.svg": b, "./assets/flags/de.svg": x, "./assets/flags/dk.svg": S, "./assets/flags/es.svg": C, "./assets/flags/fi.svg": ee, "./assets/flags/fr.svg": te, "./assets/flags/gb.svg": ne, "./assets/flags/hk.svg": re, "./assets/flags/hu.svg": ie, "./assets/flags/ie.svg": ae, "./assets/flags/in.svg": oe, "./assets/flags/it.svg": se, "./assets/flags/jp.svg": ce, "./assets/flags/kr.svg": w, "./assets/flags/kz.svg": T, "./assets/flags/nl.svg": le, "./assets/flags/no.svg": ue, "./assets/flags/pl.svg": de, "./assets/flags/pt.svg": E, "./assets/flags/ro.svg": fe, "./assets/flags/ru.svg": D, "./assets/flags/se.svg": pe, "./assets/flags/sg.svg": me, "./assets/flags/tr.svg": he, "./assets/flags/ua.svg": ge, "./assets/flags/us.svg": _e, "./assets/flags/al.svg": `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20980%20700'%3e%3cpath%20fill='%23da291c'%20d='M0%200h980v700H0z'/%3e%3cpath%20fill='%23000'%20d='M490%20220c-15-20-40-30-60-20%2010%2015%2015%2035%205%2050-25-30-70-35-95-10%2015%2020%2035%2030%2060%2030-30%2010-65%2035-70%2070%2025-10%2055-5%2075%2015-20%2020-30%2050-25%2080%2020-15%2045-20%2065-10-10%2025-5%2055%2015%2075%2015-20%2025-45%2030-75%205%2030%2015%2055%2030%2075%2020-20%2025-50%2015-75%2020-10%2045-5%2065%2010%205-30-5-60-25-80%2020-20%2050-25%2075-15-5-35-40-60-70-70%2025%200%2045-10%2060-30-25-25-70-20-95%2010-10-15-5-35%205-50-20-10-45%200-60%2020z'/%3e%3c/svg%3e`, "./assets/flags/ar.svg": `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20800%20500'%3e%3cpath%20fill='%2374acdf'%20d='M0%200h800v500H0z'/%3e%3cpath%20fill='%23fff'%20d='M0%20167h800v166H0z'/%3e%3ccircle%20cx='400'%20cy='250'%20r='40'%20fill='%23f6b40e'/%3e%3c/svg%3e`, "./assets/flags/au.svg": `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%201200%20600'%3e%3cpath%20fill='%2300205b'%20d='M0%200h1200v600H0z'/%3e%3cpath%20stroke='%23fff'%20stroke-width='60'%20d='M0%200l600%20300M600%200L0%20300'/><path%20stroke='%23cc0000'%20stroke-width='25'%20d='M0%200l600%20300M600%200L0%20300'/><path%20fill='%23fff'%20d='M250%200h100v300H250zM0%20100h600v100H0z'/><path%20fill='%23cc0000'%20d='M275%200h50v300H275zM0%20125h600v50H0z'/%3e%3ccircle%20cx='300'%20cy='450'%20r='45'%20fill='%23fff'/%3e%3ccircle%20cx='900'%20cy='450'%20r='30'%20fill='%23fff'/%3e%3ccircle%20cx='1000'%20cy='250'%20r='25'%20fill='%23fff'/%3e%3ccircle%20cx='800'%20cy='200'%20r='25'%20fill='%23fff'/%3e%3ccircle%20cx='900'%20cy='120'%20r='25'%20fill='%23fff'/%3e%3c/svg%3e`, "./assets/flags/auto.svg": `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20512%20512'%3e%3crect%20width='512'%20height='512'%20rx='100'%20fill='%23101b2b'/%3e%3cpath%20fill='%2310b981'%20d='M280%2064L136%20288h104l-24%20160%20160-224H272z'/%3e%3c/svg%3e` })).map(([e2, t2]) => [e2.match(/\/([a-z0-9_-]+)\.svg$/)?.[1] ?? ``, t2]).filter(([e2]) => /^[a-z0-9_-]{2,6}$/.test(e2))), Cf = [{ id: `dashboard`, label: `Главная`, icon: yd }, { id: `vpn`, label: `Соединение`, icon: Ad }, { id: `dns`, label: `DNS`, icon: hd }, { id: `zapret`, label: `Профили`, icon: Td }, { id: `telegram-proxy`, label: `Telegram`, icon: Dd }, { id: `settings`, label: `Настройки`, icon: Od }], wf = [0.22, 1, 0.36, 1], Tf = [0.4, 0, 1, 1], Ef = { enter: { opacity: 0, scale: 0.997 }, idle: { opacity: 1, scale: 1, transition: { type: `spring`, stiffness: 440, damping: 38, staggerChildren: 0.012 } }, leave: { opacity: 0, transition: { duration: 0.1, ease: Tf } } }, Df = { enter: { opacity: 0, y: 3 }, idle: { opacity: 1, y: 0, transition: { duration: 0.18, ease: wf } }, leave: { opacity: 0, transition: { duration: 0.08, ease: Tf } } }, Of = { type: `spring`, stiffness: 460, damping: 33, mass: 0.7 }, kf = { duration: 0.12, ease: Tf }, Af = [16, 26, 20, 38, 31, 47, 44, 59, 53, 71, 64, 82, 76, 92], jf = 6e3, Mf = 2e3, Nf = 6e4, Pf = { good: 2400, warn: 6e3, bad: 8e3 }, Ff = 1e4;
function If(e2) {
  return e2.startsWith(`setting-`) || e2 === `update-auto` || e2 === `vpn-favorite` ? `local-preference` : e2 === `internet-fix` ? `network-global` : e2.startsWith(`vpn-`) || e2.startsWith(`subscription-`) ? `vpn-route` : e2.startsWith(`dns-`) || e2.startsWith(`doh-`) ? `dns-stack` : e2.startsWith(`zapret-`) ? `zapret-driver` : e2.startsWith(`tg-`) && e2 !== `tg-copy` ? `telegram-sidecar` : e2.startsWith(`update-`) || e2 === `release-page` ? `updates` : `independent:${e2}`;
}
function Lf(e2, t2) {
  return e2 === t2 ? true : e2 === `network-global` || t2 === `network-global` ? [`vpn-route`, `dns-stack`, `zapret-driver`, `telegram-sidecar`, `network-global`].includes(e2) && [`vpn-route`, `dns-stack`, `zapret-driver`, `telegram-sidecar`, `network-global`].includes(t2) : e2 === `vpn-route` && t2 === `zapret-driver` || e2 === `zapret-driver` && t2 === `vpn-route`;
}
function Rf(e2) {
  return e2 === `internet-fix` || e2 === `vpn-favorite` || e2.startsWith(`vpn-`) || e2.startsWith(`subscription-`) || e2.startsWith(`dns-`) || e2.startsWith(`doh-`) || e2.startsWith(`zapret-`) || e2.startsWith(`tg-`) && ![`tg-copy`, `tg-open`, `tg-logs`].includes(e2);
}
var zf = { manualPrimary: `1.1.1.1`, manualSecondary: `8.8.8.8`, provider: `Gravityless DNS`, localAddress: `127.0.0.1`, localPort: 53, upstreamEndpoint: `dns.gravityless.space:8443`, dohUrl: `https://dns.gravityless.space:8443/dns-query/734f3c05`, stamp: `sdns://AgcAAAAAAAAAAAAaZG5zLmdyYXZpdHlsZXNzLnNwYWNlOjg0NDMTL2Rucy1xdWVyeS83MzRmM2MwNQ` }, Bf = { host: `127.0.0.1`, port: 1443, secret: ``, dcIp: [], verbose: false, bufKb: 256, poolSize: 8, logMaxMb: 5, checkUpdates: true }, Vf = [{ id: `cloudflare`, name: `Cloudflare`, note: `Быстро`, servers: [`1.1.1.1`, `1.0.0.1`] }, { id: `google`, name: `Google DNS`, note: `Совместимо`, servers: [`8.8.8.8`, `8.8.4.4`] }, { id: `quad9`, name: `Quad9`, note: `Безопасно`, servers: [`9.9.9.9`, `149.112.112.112`] }, { id: `adguard`, name: `AdGuard`, note: `Фильтрация`, servers: [`94.140.14.14`, `94.140.15.15`] }], Hf = [{ host: `api.openai.com`, label: `OpenAI` }, { host: `api.anthropic.com`, label: `Claude` }, { host: `gemini.google.com`, label: `Gemini` }], Uf = { generalDomains: ``, includedCidrs: ``, excludedDomains: ``, excludedCidrs: `` }, Wf = `egoistshield.zapret.autoSelect`, Gf = 2, Kf = 17;
function qf(e2) {
  let t2 = Array.isArray(e2?.results) ? e2.results : Array.isArray(e2?.testResults) ? e2.testResults : [];
  return t2.length > 0;
}
function zapretHistoryResult(result, previous = null) {
  if (!qf(result) || (result.cancelled === true || result.completed === false) && previous && previous.completed !== false && !previous.cancelled) return previous;
  const rows = Array.isArray(result.results) ? result.results : result.testResults;
  const testedAt = result.testedAt || new Date().toISOString();
  if (previous?.testedAt && Date.parse(previous.testedAt) > Date.parse(testedAt)) return previous;
  return { ...result, results: rows, testedProfiles: rows.map(row => Q(row?.configName, row?.name, row?.configId, row?.id)).filter(Boolean), testedAt };
}
function zapretHistoryRows(result) {
  const rows = Array.isArray(result?.results) ? result.results : Array.isArray(result?.testResults) ? result.testResults : [];
  return zm(null, rows, result);
}
function Jf() {
  try {
    let e2 = window.localStorage.getItem(Wf), t2 = e2 ? JSON.parse(e2) : null;
    return t2 ? t2.schemaVersion !== Gf || !qf(t2) ? (window.localStorage.removeItem(Wf), null) : t2 : null;
  } catch {
    return null;
  }
}
function Yf(e2) {
  try {
    if (!e2) return;
    let t2 = typeof e2 == `object` && e2 ? { ...e2, schemaVersion: Gf, targetCount: Kf } : e2;
    window.localStorage.setItem(Wf, JSON.stringify(t2));
  } catch {
  }
}
function Xf() {
  try {
    window.localStorage.removeItem(Wf);
  } catch {
  }
}
var Zf = { "vpn-toggle": { title: `Подключение`, detail: `Готовлю runtime, маршрут и системные правила.` }, "vpn-disconnect": { title: `Отключение`, detail: `Останавливаю owned runtime и снимаю системные proxy/kill-switch правила.` }, "vpn-connect-node": { title: `Подключение`, detail: `Подключаю выбранный сервер через owned runtime.` }, "vpn-favorite": { title: `Избранное`, detail: `Сохраняю сервер в списке избранных.` }, "vpn-import": { title: `Импорт`, detail: `Читаю буфер обмена и добавляю подписку или конфигурацию.` }, "subscription-refresh": { title: `Обновление подписки`, detail: `Запрашиваю свежий список серверов у провайдера.` }, "subscription-delete": { title: `Удаление подписки`, detail: `Удаляю подписку и её узлы из локального состояния.` }, "copy-ip": { title: `Копирование IP`, detail: `Копирую текущий внешний IP в буфер обмена.` }, speedtest: { title: `Замер скорости`, detail: `Проверяю доступность и скорость активного маршрута.` }, "internet-fix": { title: `Восстановление сети`, detail: `Отменяю только свои изменения и проверяю связность. Чужие DNS, WinHTTP/PAC и Telegram не затрагиваются.` }, "route-probe": { title: `Проверка защиты`, detail: `Проверяю смену внешнего выхода, применение маршрута в Windows и путь DNS.` }, "vpn-reapply-route": { title: `Повторное применение маршрута`, detail: `Направляю Windows на локальный прокси активной сессии.` }, "dns-apply": { title: `Настройка DNS`, detail: `Применяю DNS к активным физическим адаптерам.` }, "dns-reset": { title: `Сброс DNS`, detail: `Возвращаю DNS к настройкам Windows/DHCP.` }, "dns-check": { title: `Проверка DNS`, detail: `Проверяю DNS без активного соединения.` }, "dns-link-paste": { title: `Вставка DNS-ссылки`, detail: `Читаю ссылку из буфера и распознаю DoH/DoT формат.` }, "dns-link-apply": { title: `Подключение DNS-ссылки`, detail: `Проверяю DNS-ссылку и включаю защищённый System DoH канал.` }, "doh-apply": { title: `Включение System DoH`, detail: `Настраиваю штатный Windows DNS Client и проверяю системное разрешение имён.` }, "doh-reset": { title: `Отключение System DoH`, detail: `Возвращаю исходные DNS/DoH-настройки, принадлежавшие системе или пользователю.` }, "doh-restart": { title: `Проверка System DoH`, detail: `Повторно применяю DoH-политику Windows и проверяю системный DNS.` }, "gravityless-enable": { title: `Локальный DNS`, detail: `Переключаю системный DNS на локальный resolver.` }, "zapret-auto": { title: `Автоподбор профилей`, detail: `По очереди проверяю доступные профили Zapret.` }, "zapret-standalone": { title: `Запуск профиля`, detail: `Запускаю выбранный профиль в standalone-режиме.` }, "zapret-service-start": { title: `Запуск службы Zapret`, detail: `Запускаю owned службу с текущим профилем.` }, "zapret-service-install": { title: `Установка службы Zapret`, detail: `Переустанавливаю owned службу EgoistShieldZapret с выбранным профилем.` }, "zapret-service-stop": { title: `Остановка службы Zapret`, detail: `Останавливаю только owned службу EgoistShieldZapret.` }, "zapret-remove": { title: `Удаление службы Zapret`, detail: `Удаляю только owned-службу EgoistShieldZapret.` }, "zapret-reset": { title: `Сброс Zapret`, detail: `Останавливаю owned WinDriver/WinWS процессы.` }, "zapret-stop-standalone": { title: `Остановка standalone Zapret`, detail: `Останавливаю отдельный owned winws-процесс.` }, "zapret-game-filter": { title: `Игровой фильтр`, detail: `Обновляю режим GameFilter в Flowseal core.` }, "zapret-ipset-mode": { title: `IPSet Flowseal`, detail: `Переключаю режим IPSet для Discord Fix.` }, "zapret-update-ipset": { title: `Обновление IPSet`, detail: `Обновляю список IPSet из Flowseal.` }, "zapret-save-lists": { title: `Маршруты Discord`, detail: `Сохраняю пользовательские домены и IP/CIDR списки.` }, "zapret-check-updates": { title: `Обновления Flowseal`, detail: `Проверяю доступную версию Flowseal Core.` }, "zapret-install-update": { title: `Установка Flowseal Core`, detail: `Применяю совместимое обновление Flowseal Core.` }, "zapret-emergency-core": { title: `Аварийный Flowseal Core`, detail: `Переключаю ядро на fallback-версию 1.9.2.` }, "zapret-tests": { title: `Тесты Flowseal`, detail: `Открываю консоль тестов Flowseal.` }, "zapret-clean-cache": { title: `Очистка Discord-кеша`, detail: `Закрываю Discord-клиенты и очищаю только Electron cache.` }, "zapret-diagnostics": { title: `Диагностика Zapret`, detail: `Собираю состояние Flowseal, драйверов, службы и списков.` }, "tg-open": { title: `Открытие Telegram`, detail: `Передаю ссылку прокси в Telegram Desktop.` }, "tg-start": { title: `Запуск оптимизатора Telegram`, detail: `Запускаю owned proxy runtime с безопасной конфигурацией.` }, "tg-install": { title: `Установка службы оптимизатора`, detail: `Устанавливаю owned службу и автозапуск.` }, "tg-remove": { title: `Удаление службы оптимизатора`, detail: `Удаляю owned службу Telegram Proxy.` }, "tg-logs": { title: `Открытие логов оптимизатора`, detail: `Открываю папку с журналами proxy runtime.` }, "tg-update": { title: `Обновление оптимизатора Telegram`, detail: `Проверяю и при необходимости применяю совместимый headless runtime.` }, "open-log-folder": { title: `Открытие журналов`, detail: `Открываю папку журналов приложения.` }, "release-page": { title: `Открытие релиза`, detail: `Открываю страницу релиза во внешнем браузере.` }, "update-check": { title: `Проверка обновлений`, detail: `Проверяю канал обновлений и release metadata.` }, "update-auto": { title: `Настройка обновлений`, detail: `Сохраняю режим автоматической проверки.` }, "setting-autoStart": { title: `Автозапуск Windows`, detail: `Обновляю login item Windows для EgoistShield.` }, "setting-minimizeToTray": { title: `Режим трея`, detail: `Сохраняю поведение окна при закрытии приложения.` }, "setting-notifications": { title: `Уведомления`, detail: `Сохраняю показ системных уведомлений.` }, "setting-soundNotifications": { title: `Звуковые оповещения`, detail: `Меняю локальный звук для действий и ошибок.` }, "setting-autoConnect": { title: `Автоподключение маршрута`, detail: `Сохраняю подключение после старта приложения.` }, "setting-reconnectOnDrop": { title: `Переподключение`, detail: `Сохраняю автоповтор подключения при сбое.` }, "setting-sendSubscriptionHwid": { title: `Приватность подписок`, detail: `Обновляю согласие на передачу совместимого идентификатора провайдеру.` }, "setting-killSwitch": { title: `Kill Switch`, detail: `Сохраняю правило блокировки трафика без соединения.` }, "setting-keepLogsDays": { title: `Хранение логов`, detail: `Очищаю старые журналы по новому сроку.` }, "admin-check": { title: `Проверка прав`, detail: `Проверяю, запущено ли приложение с правами администратора.` }, "diagnostics-export": { title: `Экспорт диагностики`, detail: `Собираю архив логов, статусов runtime и настроек без секретов.` }, "vpn-auto-connect": { title: `Автоподключение`, detail: `Приложение запускает сохранённый маршрут.` }, "vpn-reconnect": { title: `Переподключение`, detail: `Пробую восстановить сессию после обрыва.` } }, Qf = `3.7.0`, $f = `12.09.2026`, ep = [[`Lagom`, `12.09.2026`, [`Чёрно-белый интерфейс, компактный виджет и настройки`, `Исправлены подготовка установки и восстановление прерванного обновления`, `Уточнены статусы соединения, DNS и фоновых служб`, `Исправлены переносы текста и управление с клавиатуры`]]];
function tp(e2) {
  try {
    let t2 = window.AudioContext ?? window.webkitAudioContext;
    if (!t2) return;
    let n2 = new t2(), r2 = n2.createOscillator(), i2 = n2.createGain();
    r2.type = `sine`, r2.frequency.value = e2 === `good` ? 620 : 180, i2.gain.setValueAtTime(1e-4, n2.currentTime), i2.gain.exponentialRampToValueAtTime(0.05, n2.currentTime + 0.015), i2.gain.exponentialRampToValueAtTime(1e-4, n2.currentTime + 0.18), r2.connect(i2), i2.connect(n2.destination), r2.start(), r2.stop(n2.currentTime + 0.2), window.setTimeout(() => void n2.close().catch(() => void 0), 260);
  } catch {
  }
}
function np() {
  let [e2, t2] = O.useState(() => rp()), [n2, r2] = O.useState({ state: null, isAdmin: null, vpn: null, dns: null, dnsCheck: null, systemDoh: null, zapret: null, zapretProfiles: [], zapretAutoSelect: Jf(), zapretProgress: null, telegram: null, health: null, network: null, myIp: null, runtimeLogs: [], trafficSeries: [], diagnosticsExport: null, traffic: { rx: 0, tx: 0 }, speedtest: null, speedProgress: null, routeProbe: null, update: null, busy: null, busyActions: [] }), [i2, a2] = O.useState(null), [o2, s2] = O.useState(null), [c2, l2] = O.useState(false), u2 = O.useCallback(() => {
    l2(false), window.egoistAPI?.system?.cancelSpeedtest?.().catch(() => void 0);
  }, []), d2 = O.useRef(0), f2 = O.useRef(/* @__PURE__ */ new Map()), p2 = O.useRef(false), m2 = O.useRef(false), h2 = O.useRef(false), g2 = n2.busy ? `active` : `idle`, _2 = O.useRef(null);
  _2.current = n2.busy, O.useEffect(() => {
    p2.current = !!n2.state?.settings?.soundNotifications;
  }, [n2.state?.settings?.soundNotifications]), O.useEffect(() => {
    if (!o2) return;
    let e3 = Pf[o2.tone];
    if (!e3) return;
    let { id: t3, startedAt: n3 } = o2, r3 = window.setTimeout(() => {
      s2((e4) => e4?.id === t3 && e4.startedAt === n3 ? null : e4);
    }, e3);
    return () => window.clearTimeout(r3);
  }, [o2?.id, o2?.startedAt, o2?.tone]);
  let v2 = O.useCallback(async () => {
    let e3 = window.egoistAPI, t3 = await Promise.allSettled([e3?.state?.get?.(), e3?.app?.isAdmin?.(), e3?.vpn?.status?.(), e3?.system?.dnsControllerStatus?.(), e3?.system?.systemDohStatus?.(), e3?.zapret?.status?.(), e3?.zapret?.listProfiles?.(), e3?.telegramProxy?.status?.(), e3?.health?.getReport?.(), e3?.network?.inspect?.(), e3?.system?.getMyIp?.(), e3?.logs?.getRuntimeSummary?.(40), e3?.telegramProxy?.tailLogs?.(40)]);
    r2((e4) => {
      let n3 = im(t3[2]), r3 = $(n3?.pingMs, e4.vpn?.pingMs);
      return { ...e4, state: im(t3[0]), isAdmin: typeof im(t3[1]) == `boolean` ? im(t3[1]) : null, vpn: n3 && r3 != null ? { ...n3, pingMs: r3 } : n3, dns: im(t3[3]), systemDoh: im(t3[4]), zapret: im(t3[5]), zapretAutoSelect: zapretHistoryResult(im(t3[5])?.autoSelectHistory, e4.zapretAutoSelect), zapretProfiles: im(t3[6]) ?? [], telegram: im(t3[7]), health: im(t3[8]), network: im(t3[9]), myIp: im(t3[10]), runtimeLogs: [...am(im(t3[11]), `RUNTIME`), ...am(im(t3[12]), `TG`)] };
    });
  }, []), y2 = O.useCallback(async () => {
    let e3 = window.egoistAPI, t3 = await Promise.allSettled([e3?.state?.get?.(), e3?.vpn?.status?.(), e3?.system?.dnsControllerStatus?.(), e3?.system?.systemDohStatus?.(), e3?.zapret?.status?.(), e3?.telegramProxy?.status?.()]);
    r2((e4) => {
      let n3 = im(t3[1]), r3 = $(n3?.pingMs, e4.vpn?.pingMs);
      return { ...e4, state: im(t3[0]) ?? e4.state, vpn: n3 ? r3 == null ? n3 : { ...n3, pingMs: r3 } : e4.vpn, dns: im(t3[2]) ?? e4.dns, systemDoh: im(t3[3]) ?? e4.systemDoh, zapret: im(t3[4]) ?? e4.zapret, zapretAutoSelect: zapretHistoryResult(im(t3[4])?.autoSelectHistory, e4.zapretAutoSelect), telegram: im(t3[5]) ?? e4.telegram };
    });
  }, []);
  O.useEffect(() => {
    let e3 = true, t3 = async (t4 = false) => {
      if (!(!e3 || document.hidden || h2.current)) {
        h2.current = true;
        try {
          await (t4 ? v2() : y2());
        } finally {
          h2.current = false;
        }
      }
    }, n3 = () => {
      document.hidden || t3(true);
    };
    t3(true);
    let r3 = _2.current ? Mf : jf, i3 = window.setInterval(() => void t3(false), r3), a3 = window.setInterval(() => void t3(true), Nf);
    return document.addEventListener(`visibilitychange`, n3), () => {
      e3 = false, window.clearInterval(i3), window.clearInterval(a3), document.removeEventListener(`visibilitychange`, n3);
    };
  }, [v2, y2, g2]), O.useEffect(() => {
    let e3 = window.egoistAPI?.traffic?.onUpdate?.((e4) => {
      r2((t3) => ({ ...t3, traffic: { rx: Number.isFinite(e4?.rx) ? Math.max(0, Number(e4.rx)) : 0, tx: Number.isFinite(e4?.tx) ? Math.max(0, Number(e4.tx)) : 0 }, trafficSeries: km(t3.trafficSeries, Number(e4?.rx) + Number(e4?.tx)) }));
    });
    return () => e3?.();
  }, []), O.useEffect(() => {
    let e3 = window.egoistAPI?.system?.onSpeedtestProgress?.((e4) => {
      r2((t3) => ({ ...t3, speedProgress: e4 })), s2({ id: `speedtest`, tone: e4?.phase === `error` ? `bad` : e4?.phase === `complete` ? `good` : `info`, title: `Замер скорости`, detail: Q(e4?.detail) ?? `Измеряю активный маршрут.`, startedAt: Date.now() });
    });
    return () => e3?.();
  }, []);
  let b2 = wm(n2.vpn), x2 = Q(n2.vpn?.activeNodeId, n2.state?.activeNodeId);
  O.useEffect(() => {
    if (!b2) {
      r2((e4) => e4.vpn ? { ...e4, vpn: { ...e4.vpn, pingMs: null } } : e4);
      return;
    }
    let e3 = false, t3 = async () => {
      if (!document.hidden) try {
        let t4 = await Z(`system.pingActiveProxy`, window.egoistAPI?.system?.pingActiveProxy);
        if (e3) return;
        r2((e4) => ({ ...e4, vpn: { ...e4.vpn ?? {}, pingMs: typeof t4 == `number` && t4 > 0 ? t4 : null } }));
      } catch {
        e3 || r2((e4) => e4.vpn ? { ...e4, vpn: { ...e4.vpn, pingMs: null } } : e4);
      }
    };
    t3();
    let n3 = window.setInterval(t3, Ff);
    return () => {
      e3 = true, window.clearInterval(n3);
    };
  }, [x2, b2]), O.useEffect(() => {
    let e3 = window.egoistAPI?.zapret?.onAutoSelectProgress?.((e4) => {
      let t3 = Tm(e4);
      r2((t4) => ({ ...t4, zapretProgress: e4 })), s2({ id: `zapret-auto`, tone: t3.tone, title: t3.title, detail: t3.detail, startedAt: Date.now() }), [`complete`, `cancelled`].includes(String(e4?.phase ?? ``)) && window.setTimeout(() => {
        r2((t4) => t4.zapretProgress === e4 ? { ...t4, zapretProgress: null } : t4);
      }, 1800);
    });
    return () => e3?.();
  }, []);
  let S2 = O.useCallback(async (e3, t3, n3) => {
    let i3 = If(e3);
    if ([...f2.current.keys()].some((e4) => Lf(i3, e4))) return false;
    f2.current.set(i3, e3);
    let a3 = d2.current + 1;
    d2.current = a3;
    let o3 = () => d2.current === a3, c3 = Zf[e3] ?? { title: `Выполняется действие`, detail: n3 }, u3 = Date.now();
    s2({ id: e3, tone: `info`, title: c3.title, detail: c3.detail, startedAt: u3 }), e3 === `speedtest` && l2(true), r2((t4) => ({ ...t4, busy: e3, busyActions: t4.busyActions.includes(e3) ? t4.busyActions : [...t4.busyActions, e3], ...e3 === `zapret-auto` ? { zapretProgress: { phase: `start`, startedAt: (/* @__PURE__ */ new Date()).toISOString() } } : {}, ...e3 === `speedtest` ? { speedtest: null, speedProgress: null } : {} }));
    try {
      let i4 = await t3();
      if (e3 === `speedtest` && r2((e4) => ({ ...e4, speedtest: i4 })), e3 === `update-check` && r2((e4) => ({ ...e4, update: i4 })), i4 && typeof i4 == `object` && `ok` in i4 && i4.ok === false) throw Error(sm(i4, `Backend rejected ${e3}.`));
      if (i4 === false) throw Error(`Backend rejected ${e3}.`);
      if (i4 && typeof i4 == `object` && om(i4) && e3 !== `speedtest`) throw Error(sm(i4));
      e3 === `route-probe` && r2((e4) => ({ ...e4, routeProbe: i4 }));
      let a4 = e3 === `route-probe` ? gp(i4) : null;
      e3 === `dns-check` && r2((e4) => ({ ...e4, dnsCheck: i4 })), e3 === `admin-check` && r2((e4) => ({ ...e4, isAdmin: !!i4?.isAdmin })), e3 === `diagnostics-export` && r2((e4) => ({ ...e4, diagnosticsExport: i4 }));
      let l3 = e3 === `zapret-auto` && i4?.cancelled === true;
      if (e3 === `zapret-auto`) {
        r2((previous) => {
          const history = zapretHistoryResult(i4, previous.zapretAutoSelect);
          Yf(history);
          return { ...previous, zapretAutoSelect: history, zapretProgress: { phase: i4?.cancelled === true ? `cancelled` : `complete`, bestProfile: Q(i4?.bestProfile), testedAt: history?.testedAt } };
        });
      }
      if (o3()) {
        let t4 = l3 ? `warn` : a4?.tone ?? `good`;
        s2({ id: e3, tone: t4, title: l3 ? `Автоподбор остановлен` : a4?.title ?? c3.title, detail: l3 ? `Сохранена история завершённых проверок` : a4?.detail ?? n3, startedAt: Date.now() }), p2.current && !l3 && tp(t4 === `bad` ? `bad` : `good`);
      }
      return Rf(e3) && await y2(), true;
    } catch (t4) {
      e3 === `zapret-auto` && r2((previous) => ({ ...previous, zapretProgress: null }));
      let n4 = cm(t4, e3);
      return o3() && (s2({ id: e3, tone: `bad`, title: n4.title, detail: n4.detail, startedAt: Date.now() }), p2.current && tp(`bad`)), false;
    } finally {
      f2.current.get(i3) === e3 && f2.current.delete(i3), r2((t4) => {
        let n4 = t4.busyActions.filter((t5) => t5 !== e3);
        return { ...t4, busyActions: n4, busy: t4.busy === e3 ? n4.at(-1) ?? null : t4.busy };
      });
    }
  }, [y2]);
  O.useEffect(() => {
    let e3 = window.egoistAPI?.autoConnect?.onAutoConnect?.(() => {
      S2(`vpn-auto-connect`, () => Z(`vpn.connect`, window.egoistAPI?.vpn?.connect), `Автоподключение запущено`);
    });
    return () => e3?.();
  }, [S2]), O.useEffect(() => {
    let e3 = window.egoistAPI?.updater?.onUpdateAvailable?.((e4) => {
      r2((t4) => ({ ...t4, update: { ...t4.update ?? {}, ...e4, ok: true, phase: `available`, latestVersion: e4.version } }));
    }), t3 = window.egoistAPI?.updater?.onDownloadProgress?.((e4) => {
      r2((t4) => ({ ...t4, update: { ...t4.update ?? {}, ok: ![`blocked`, `failed`].includes(String(e4.phase)), phase: e4.phase, message: e4.message, progressPercent: e4.percent, transferred: e4.transferred, total: e4.total, latestVersion: e4.version ?? t4.update?.latestVersion } }));
    }), n3 = window.egoistAPI?.updater?.onUpdateError?.((e4) => {
      r2((t4) => ({ ...t4, update: { ...t4.update ?? {}, ok: false, phase: `failed`, message: e4.message, failureCode: e4.code, retryable: e4.retryable } })), s2({ id: `update-error`, tone: `bad`, title: `Обновление заблокировано`, detail: Q(e4?.message) ?? `Канал обновлений не прошёл проверку доверия.`, startedAt: Date.now() });
    });
    return () => {
      e3?.(), t3?.(), n3?.();
    };
  }, []), O.useEffect(() => {
    Z(`updater.getLastResult`, window.egoistAPI?.updater?.getLastResult).then((e3) => {
      e3 && s2({ id: `update-completed`, tone: e3.ok === true ? `good` : `bad`, title: e3.ok === true ? `Egoist Lagom обновлён` : `Обновление не завершено`, detail: Q(e3.message) ?? (e3.ok === true ? `Новая версия установлена и запущена.` : `Предыдущая версия восстановлена.`), startedAt: Date.now() });
    }).catch(() => void 0);
  }, []), O.useEffect(() => {
    e2 !== `settings` || n2.update || m2.current || (m2.current = true, Z(`updater.check`, window.egoistAPI?.updater?.check).then((e3) => r2((t3) => ({ ...t3, update: e3 }))).catch(() => void 0));
  }, [e2, n2.update]), O.useEffect(() => {
    let e3 = n2.vpn?.reconnect;
    if (n2.busy || !e3 || ![`waiting`, `reconnecting`].includes(String(e3.phase))) {
      s2((e4) => e4?.id === `vpn-reconnect` ? null : e4);
      return;
    }
    let t3 = Date.parse(String(e3.nextAttemptAt ?? ``)), r3 = Number.isFinite(t3) ? Math.max(1, Math.ceil((t3 - Date.now()) / 1e3)) : null;
    s2({ id: `vpn-reconnect`, tone: `warn`, title: e3.phase === `reconnecting` ? `Переподключение` : `Соединение потеряно`, detail: e3.phase === `reconnecting` ? `Попытка ${Math.max(1, Number(e3.attempt) || 1)}. Ручное отключение отменит автоповтор.` : `Следующая попытка через ${r3 ?? `несколько`} с. ${Q(e3.lastReason) ?? `Маршрут недоступен.`}`, startedAt: Date.now() });
  }, [n2.busy, n2.vpn?.reconnect?.attempt, n2.vpn?.reconnect?.nextAttemptAt, n2.vpn?.reconnect?.phase]);
  let C2 = O.useCallback(async () => {
    try {
      let e3 = await Z(`system.dnsDiagnostics`, window.egoistAPI?.system?.dnsDiagnostics);
      return r2((t3) => ({ ...t3, dnsCheck: e3 })), e3;
    } catch {
      return null;
    }
  }, []), ee2 = O.useCallback((e3, t3, n3, r3) => {
    a2({ title: e3, body: t3, actionLabel: n3, onConfirm: r3, tone: `warning` });
  }, []);
  return (0, V.jsxs)(ap, { activeScreen: e2, activity: o2, onAppInfo: O.useCallback(() => {
    (async () => {
      let e3 = await window.egoistAPI?.app?.getVersion?.().catch(() => null), t3 = e3?.version ?? Qf, n3 = e3?.buildDate ?? $f, r3 = ep[0], i3 = (r3?.[2] ?? []).slice(0, 4).map((e4) => `• ${e4}`).join(`
`);
      a2({ title: `О приложении`, body: `Версия приложения ${t3}
Дата сборки: ${n3}

Что нового в ${r3?.[0] ?? t3}:
${i3}

Egoist Lagom подтверждает внешний маршрут до показа защищённого состояния, изменяет системные настройки транзакционно и управляет только собственными процессами и службами.`, tone: `info` });
    })();
  }, []), onDismissActivity: () => s2(null), onNavigate: t2, snapshot: n2, children: [(0, V.jsx)(cp, { activeScreen: e2 }), (0, V.jsx)(ul, { initial: false, mode: `sync`, children: (0, V.jsx)(td.section, { animate: `idle`, className: `screen-stage`, "data-screen": e2, exit: `leave`, initial: `enter`, variants: Ef, children: ip(e2, n2, S2, ee2, t2, C2, o2, c2, u2) }, e2) }), (0, V.jsx)(rm, { onClose: () => a2(null), state: i2 })] });
}
function rp() {
  let e2 = new URLSearchParams(window.location.search).get(`screen`);
  return Cf.some((t2) => t2.id === e2) ? e2 : `dashboard`;
}
function ip(e2, t2, n2, r2, i2, a2, o2, s2, c2) {
  switch (e2) {
    case `dashboard`:
      return (0, V.jsx)(lp, { snapshot: t2, runAction: n2, confirmAction: r2, onNavigate: i2, speedPanelVisible: s2, onCloseSpeedPanel: c2 });
    case `vpn`:
      return (0, V.jsx)(Sp, { snapshot: t2, runAction: n2 });
    case `dns`:
      return (0, V.jsx)(wp, { snapshot: t2, runAction: n2, confirmAction: r2, refreshDnsDiagnostics: a2 });
    case `zapret`:
      return (0, V.jsx)(Tp, { snapshot: t2, runAction: n2, confirmAction: r2, activity: o2 });
    case `telegram-proxy`:
      return (0, V.jsx)(Ep, { snapshot: t2, runAction: n2, confirmAction: r2 });
    case `settings`:
      return (0, V.jsx)(Dp, { snapshot: t2, runAction: n2 });
    default:
      return (0, V.jsx)(lp, { snapshot: t2, runAction: n2, confirmAction: r2, onNavigate: i2, speedPanelVisible: s2, onCloseSpeedPanel: c2 });
  }
}
function ap({ activeScreen: e2, activity: t2, children: n2, onAppInfo: r2, onDismissActivity: i2, onNavigate: a2, snapshot: o2 }) {
  return (0, V.jsxs)(`main`, { className: `app-shell`, "data-busy": o2.busy ?? ``, "data-screen": e2, children: [(0, V.jsx)(sp, { activeScreen: e2, onAppInfo: r2, onNavigate: a2, snapshot: o2 }), (0, V.jsx)(`section`, { className: `workspace`, children: n2 }), (0, V.jsx)(op, { activity: e2 === `dashboard` && t2?.id === `speedtest` ? null : t2, onDismiss: i2 })] });
}
function op({ activity: e2, onDismiss: t2 }) {
  return (0, V.jsx)(ul, { children: e2 ? (0, V.jsxs)(td.div, { "aria-atomic": `true`, "aria-live": e2.tone === `bad` ? `assertive` : `polite`, animate: { opacity: 1, y: 0, scale: 1 }, className: `activity-hud ${e2.tone}`, exit: { opacity: 0, y: -8, scale: 0.98 }, initial: { opacity: 0, y: -8, scale: 0.98 }, role: `status`, transition: { type: `spring`, stiffness: 480, damping: 34, mass: 0.68 }, children: [(0, V.jsx)(`i`, {}), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`strong`, { children: e2.title }), (0, V.jsx)(`span`, { children: e2.detail })] }), (0, V.jsx)(`button`, { "aria-label": `Закрыть уведомление`, className: `activity-hud-dismiss`, onClick: t2, type: `button`, children: (0, V.jsx)(Id, { "aria-hidden": `true`, size: 14, strokeWidth: bf }) })] }) : null });
}
function sp({ activeScreen: e2, onAppInfo: t2, onNavigate: n2, snapshot: r2 }) {
  return (0, V.jsxs)(`aside`, { className: `sidebar`, "aria-label": `Навигация Egoist Lagom`, children: [(0, V.jsxs)(`div`, { className: `brand`, children: [(0, V.jsx)(`div`, { className: `brand-mark`, "aria-hidden": `true`, children: (0, V.jsx)(`img`, { className: `brand-logo`, src: Yd, alt: `` }) }), (0, V.jsx)(`strong`, { children: `Egoist Lagom` })] }), (0, V.jsx)(`nav`, { className: `nav-list`, children: Cf.map((t3) => {
    let r3 = t3.icon, i2 = t3.id === e2;
    return (0, V.jsxs)(`button`, { "aria-current": i2 ? `page` : void 0, "aria-label": t3.label, className: i2 ? `nav-item active` : `nav-item`, onClick: () => n2(t3.id), type: `button`, children: [(0, V.jsx)(r3, { size: xf.nav, strokeWidth: bf }), (0, V.jsx)(`span`, { children: t3.label })] }, t3.id);
  }) }), (0, V.jsxs)(`div`, { className: `sidebar-tools`, children: [(0, V.jsx)(`button`, { "aria-label": r2.isAdmin ? `Статус: администратор` : `Статус: нужны права администратора`, className: r2.isAdmin === false ? `tool-warn` : void 0, type: `button`, onClick: () => n2(`dashboard`), children: (0, V.jsx)(Y, { size: xf.tool, strokeWidth: bf }) }), (0, V.jsx)(`button`, { "aria-label": `Открыть настройки`, type: `button`, onClick: () => n2(`settings`), children: (0, V.jsx)(Od, { size: xf.tool, strokeWidth: bf }) }), (0, V.jsx)(`button`, { "aria-label": `О приложении`, type: `button`, onClick: t2, children: (0, V.jsx)(dd, { size: xf.tool, strokeWidth: bf }) })] })] });
}
function cp({ activeScreen: e2 }) {
  let t2 = window.egoistAPI?.window;
  return (0, V.jsxs)(`header`, { className: `titlebar`, children: [(0, V.jsx)(`h2`, { children: Cf.find((t3) => t3.id === e2)?.label ?? `Главная` }), (0, V.jsxs)(`div`, { className: `window-controls`, children: [(0, V.jsx)(`button`, { "aria-label": `Свернуть`, onClick: () => void t2?.minimize?.(), type: `button`, children: (0, V.jsx)(Cd, { size: 14 }) }), (0, V.jsx)(`button`, { "aria-label": `Развернуть`, onClick: () => void t2?.toggleMaximize?.(), type: `button`, children: (0, V.jsx)(Sd, { size: 13 }) }), (0, V.jsx)(`button`, { "aria-label": `Закрыть`, onClick: () => void t2?.close?.(), type: `button`, children: (0, V.jsx)(Id, { size: 14 }) })] })] });
}
function lp({ confirmAction: e2, onCloseSpeedPanel: t2, onNavigate: n2, runAction: r2, snapshot: i2, speedPanelVisible: a2 }) {
  let [o2, s2] = O.useState(false), c2 = wm(i2.vpn), l2 = !!(i2.vpn?.connected || i2.vpn?.running) && !c2, u2 = /failed|error/i.test(String(i2.vpn?.lifecycle ?? ``)), d2 = c2 ? `Маршрут проверен` : l2 ? `Проверяем внешний маршрут` : u2 ? `Подключение не подтверждено` : `Соединение отключено`, f2 = c2 ? `good` : u2 ? `bad` : l2 ? `warn` : `idle`, p2 = !!(i2.zapret?.serviceRunning || i2.zapret?.standaloneRunning), m2 = dm(i2.vpn, i2.state), h2 = Q(i2.myIp?.ip, i2.network?.publicIp, i2.network?.ip, i2.health?.publicIp, i2.health?.ip, i2.vpn?.publicIp), g2 = Q(i2.myIp?.country, i2.myIp?.countryCode, i2.network?.region, i2.network?.country, i2.health?.region, i2.vpn?.region), _2 = fm(i2.vpn, i2.state) ?? Q(i2.network?.provider, i2.network?.isp, i2.health?.provider, i2.vpn?.provider, i2.myIp?.provider), v2 = $(i2.vpn?.pingMs, i2.speedtest?.pingMs, i2.health?.pingMs, i2.network?.pingMs), y2 = i2.traffic.rx > 0 || i2.traffic.tx > 0, b2 = Im(i2.vpn?.uptimeMs ?? i2.vpn?.runtimeMs ?? i2.vpn?.startedAt ?? i2.vpn?.sessionStartTime), x2 = $(i2.speedtest?.downloadMbps, i2.speedtest?.speed), S2 = $(i2.speedtest?.uploadMbps, i2.speedtest?.uploadSpeed), C2 = Q(i2.speedtest?.error), ee2 = Q(i2.speedtest?.uploadError), te2 = $(i2.speedProgress?.percent) ?? (i2.busy === `speedtest` ? 2 : 100), ne2 = i2.routeProbe?.route ?? i2.routeProbe, re2 = i2.routeProbe?.dns, ie2 = i2.busy === `speedtest` ? Q(i2.speedProgress?.detail) ?? `Готовлю точный многофазный замер маршрута` : C2 ? `Ошибка: ${C2}` : i2.speedtest ? `↓ ${x2 == null ? `нет данных` : `${x2} Мбит/с`} · ↑ ${S2 == null ? ee2 ? `недоступно` : `нет данных` : `${S2} Мбит/с`} · ${v2 == null ? `пинг —` : `${v2} мс`}` : `Скачать/отдать через текущий маршрут`, ae2 = i2.busy === `route-probe` ? `Проверяю смену выхода, применение маршрута и путь DNS` : vp(ne2, re2), oe2 = i2.busy === `vpn-toggle` || i2.busy === `vpn-disconnect`, se2 = pm(i2.state?.nodes).find((e3) => e3.id === i2.state?.activeNodeId) ?? null, ce2 = Array.isArray(i2.state?.subscriptions) ? i2.state.subscriptions[0] : null, w2 = ce2 ? Sm(ce2.expire) : null, T2 = [{ label: `Протокол`, value: se2?.protocol ? se2.protocol.toUpperCase() : `нет данных`, icon: X }, { label: `Защита DNS`, value: Pm(i2.dns, i2.systemDoh), tone: Wm(i2.dns, i2.systemDoh), icon: hd }, { label: `Подписка`, value: ce2 ? xm(ce2) ? w2 && w2 !== `Не указано` ? `до ${w2}` : `активна` : `неактивна` : `нет данных`, tone: ce2 ? xm(ce2) ? `good` : `warn` : void 0, icon: pd }, { label: `Права`, value: i2.isAdmin === true ? `Администратор` : i2.isAdmin === false ? `Обычный запуск` : `проверяются`, tone: i2.isAdmin === true ? `good` : i2.isAdmin === false ? `warn` : void 0, icon: vd }];
  return (0, V.jsxs)(`div`, { className: `dashboard-layout dashboard-v21`, children: [(0, V.jsxs)(Mp, { className: `identity-panel dashboard-identity`, children: [(0, V.jsxs)(`div`, { className: `identity-heading`, children: [(0, V.jsx)(`span`, { className: `status-pill ${f2}`, children: d2 }), (0, V.jsx)(`button`, { className: `mini-link`, type: `button`, onClick: () => n2(`vpn`), children: `Выбрать сервер` })] }), (0, V.jsxs)(`button`, { className: `identity-card copyable`, disabled: !h2, type: `button`, onClick: () => {
    h2 && r2(`copy-ip`, () => Z(`system.writeClipboard`, window.egoistAPI?.system?.writeClipboard, h2), `IP скопирован`);
  }, children: [(0, V.jsx)(`span`, { children: `Ваш IP` }), (0, V.jsx)(`strong`, { children: h2 ?? `Не проверен` }), (0, V.jsxs)(`em`, { children: [(0, V.jsx)(fd, { "aria-hidden": `true`, size: 13 }), ` Скопировать IP`] })] }), (0, V.jsxs)(`div`, { className: `identity-grid`, children: [(0, V.jsxs)(`div`, { className: `identity-card`, children: [(0, V.jsx)(`span`, { children: `Регион` }), (0, V.jsx)(`strong`, { children: g2 ?? `Не определён` })] }), (0, V.jsxs)(`div`, { className: `identity-card`, children: [(0, V.jsx)(`span`, { children: `Провайдер` }), (0, V.jsx)(`strong`, { children: _2 ?? `Не определён` })] })] }), (0, V.jsxs)(`div`, { className: `identity-card`, children: [(0, V.jsx)(`span`, { children: `Активный сервер` }), (0, V.jsx)(`strong`, { children: m2 })] }), (0, V.jsx)(`div`, { className: `identity-facts`, children: T2.map((e3) => (0, V.jsxs)(`div`, { className: `identity-fact`, children: [(0, V.jsx)(e3.icon, { "aria-hidden": `true`, size: xf.inline, strokeWidth: bf }), (0, V.jsx)(`span`, { children: e3.label }), (0, V.jsx)(`strong`, { className: e3.tone ? `${e3.tone}-text` : void 0, children: e3.value })] }, e3.label)) })] }), (0, V.jsxs)(`section`, { className: `power-zone dashboard-connect`, children: [(0, V.jsxs)(`h2`, {className: `connection-heading`, children: [`Ваша сеть.`, (0, V.jsx)(`br`, {}), (0, V.jsx)(`span`, {children: `Под вашим контролем.`})]}), (0, V.jsx)(`div`, { className: `circuit-field`, "aria-hidden": `true` }), (0, V.jsx)(jp, { busy: oe2, connected: c2, onClick: () => {
    if (c2) {
      e2(`Отключить`, `Приложение остановит owned runtime и снимет системные proxy/kill-switch правила.`, `Отключить`, () => r2(`vpn-disconnect`, () => Z(`vpn.disconnect`, window.egoistAPI?.vpn?.disconnect), `Соединение отключено`));
      return;
    }
    r2(`vpn-toggle`, () => Z(`vpn.connect`, window.egoistAPI?.vpn?.connect), `Подключение выполняется`);
  } }), (0, V.jsxs)(`div`, { className: `power-caption`, children: [(0, V.jsx)(`span`, { children: `Соединение` }), (0, V.jsx)(`strong`, { children: i2.busy === `vpn-disconnect` ? `ОТКЛЮЧЕНИЕ...` : i2.busy === `vpn-toggle` || l2 ? `ПРОВЕРКА...` : c2 ? `ПОДКЛЮЧЕНО` : u2 ? `ОШИБКА` : `ОТКЛЮЧЕНО` }), (0, V.jsx)(`em`, { children: c2 ? b2 : `00:00:00` })] })] }), (0, V.jsxs)(Mp, { className: `status-rail dashboard-status`, children: [(0, V.jsx)(Pp, { label: `Соединение`, value: d2, tone: f2 }), (0, V.jsx)(Pp, { label: `DNS`, value: Pm(i2.dns, i2.systemDoh), tone: Wm(i2.dns, i2.systemDoh) }), (0, V.jsx)(Pp, { label: `Профили`, value: p2 ? `Работает` : `Остановлен`, tone: p2 ? `good` : `idle` }), (0, V.jsx)(Pp, { label: `Telegram`, value: i2.telegram?.running ? `Оптимизируется` : `Не запущен`, tone: i2.telegram?.running ? `good` : `idle` }), (0, V.jsxs)(`div`, { className: `rail-metrics`, children: [(0, V.jsx)(`span`, { title: `Медиана трёх TCP-подключений до выбранного сервера; это не ICMP и не задержка до всех сайтов`, children: `До сервера` }), (0, V.jsx)(`strong`, { children: c2 ? v2 == null ? `проверяется` : (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(Ap, { format: (e3) => String(Math.round(e3)), value: v2 }), ` мс`] }) : `Соединение отключено` }), (0, V.jsx)(Rp, { active: c2 && v2 != null, series: i2.trafficSeries })] }), (0, V.jsxs)(`div`, { className: `rail-traffic`, children: [(0, V.jsx)(`span`, { children: `Трафик соединения` }), (0, V.jsx)(`strong`, { children: c2 ? y2 ? (0, V.jsxs)(V.Fragment, { children: [`↓ `, (0, V.jsx)(Ap, { format: Gm, value: i2.traffic.rx }), ` ↑ `, (0, V.jsx)(Ap, { format: Gm, value: i2.traffic.tx })] }) : `ожидание данных` : `Соединение отключено` })] })] }), (0, V.jsx)(`div`, { className: `dashboard-bottom dashboard-operations`, children: (0, V.jsxs)(`div`, { className: `quick-actions`, children: [(0, V.jsx)(zp, { busy: i2.busy === `speedtest`, icon: _d, progress: i2.busy === `speedtest` ? te2 : null, result: !!i2.speedtest, title: `Замер скорости`, text: ie2, onClick: () => {
    r2(`speedtest`, () => Z(`system.speedtest`, window.egoistAPI?.system?.speedtest), `Замер скорости выполнен`);
  } }), (0, V.jsx)(zp, { busy: i2.busy === `internet-fix`, icon: Fd, title: `Восстановить интернет`, text: i2.busy === `internet-fix` ? `Восстанавливаю и проверяю...` : `Вернуть только то, что менял Egoist Lagom`, onClick: () => e2(`Восстановить интернет`, `Отменяется только то, что изменял Egoist Lagom.

Будет сделано
• остановлен runtime соединения;
• восстановлен исходный системный прокси;
• удалены собственные правила Kill Switch;
• очищен кэш DNS;
• Профиль Discord вернётся в прежнее состояние.

Останется без изменений
• ваши DNS-серверы;
• WinHTTP и PAC-прокси, в том числе корпоративный;
• Telegram Proxy.

После этого интернет проверяется по-настоящему: разрешение имён и HTTPS к независимым адресам. Результат покажет, что исправлено, что сохранено и что проверено.`, `Восстановить`, () => r2(`internet-fix`, () => Z(`system.internetFix`, window.egoistAPI?.system?.internetFix), `Восстановление завершено`)) }), (0, V.jsx)(zp, { busy: i2.busy === `route-probe`, icon: Ad, result: !!i2.routeProbe, title: `Проверить защиту`, text: ae2, onClick: () => {
    s2(true), r2(`route-probe`, async () => {
      let [e3, t3] = await Promise.all([Z(`system.routeProbe`, window.egoistAPI?.system?.routeProbe), Z(`system.dnsLeakTest`, window.egoistAPI?.system?.dnsLeakTest)]);
      return { route: e3, dns: t3 };
    }, `Проверка защиты завершена`);
  } })] }) }), (0, V.jsx)(up, { onClose: t2, open: a2 && (i2.busy === `speedtest` || !!i2.speedtest), progress: i2.speedProgress, result: i2.speedtest }), (0, V.jsx)(bp, { dns: re2 ?? null, onClose: () => s2(false), onProtectionAction: (e3) => {
    switch (pp(e3)) {
      case `повторить проверку`:
        r2(`route-probe`, async () => {
          let [e4, t3] = await Promise.all([Z(`system.routeProbe`, window.egoistAPI?.system?.routeProbe), Z(`system.dnsLeakTest`, window.egoistAPI?.system?.dnsLeakTest)]);
          return { route: e4, dns: t3 };
        }, `Проверка защиты завершена`);
        return;
      case `восстановить интернет`:
        s2(false), r2(`internet-fix`, () => Z(`system.internetFix`, window.egoistAPI?.system?.internetFix), `Восстановление завершено`);
        return;
      case `применить маршрут заново`:
        s2(false), r2(`vpn-reapply-route`, () => Z(`system.reapplyRoute`, window.egoistAPI?.system?.reapplyRoute), `Маршрут применён повторно`);
        return;
      case `применить настройки dns заново`:
        s2(false), n2?.(`dns`);
        return;
      case `открыть настройки dns`:
        s2(false), n2?.(`dns`);
        return;
      case `переподключить соединение`:
      case `выбрать другой сервер`:
        s2(false), n2?.(`vpn`);
        return;
      default:
        return;
    }
  }, open: o2 && (i2.busy === `route-probe` || !!i2.routeProbe), route: ne2 ?? null })] });
}
function up({ onClose: e2, open: t2, progress: n2, result: r2 }) {
  let i2 = O.useRef(null), p3 = O.useRef(null), returnFocusRef = O.useRef(null), wasOpenRef = O.useRef(false), [a2, o2] = O.useState(t2), s2 = n2 && ![`complete`, `error`].includes(String(n2.phase ?? ``)), c2 = { high: `Высокая`, medium: `Средняя`, low: `Низкая` }, l2 = { preparing: `Подготавливаем активный маршрут`, latency: `Измеряем задержку`, download: `Измеряем скорость скачивания`, "download-loaded-latency": `Проверяем задержку под нагрузкой`, upload: `Измеряем скорость отдачи`, "upload-loaded-latency": `Проверяем стабильность отдачи`, finalizing: `Проверяем результат`, complete: `Замер завершён`, error: `Не удалось завершить замер` }, u2 = $(r2?.downloadMbps, n2?.liveDownloadMbps), d2 = $(r2?.uploadMbps, n2?.liveUploadMbps), f2 = $(r2?.pingMs, n2?.latencyMs), p2 = $(r2?.jitterMs), m2 = Math.max($(r2?.downloadLoadedLatencyMs) ?? 0, $(r2?.uploadLoadedLatencyMs) ?? 0) || null, h2 = Q(r2?.confidence), g2 = O.useMemo(() => {
    let e3 = Array.isArray(r2?.confidenceReasons) ? r2.confidenceReasons.map(String) : [];
    return e3.length > 0 ? e3.slice(0, 2) : h2 === `high` ? [`Все условия точности выполнены`] : [];
  }, [h2, r2?.confidenceReasons]), _2 = O.useMemo(() => {
    if (!r2) return [];
    let e3 = [], t3 = Q(r2.provider, r2.downloadHost);
    t3 && e3.push(`Провайдер замера: ${t3}`);
    let n3 = Q(r2.routeLabel);
    n3 && e3.push(`Маршрут: ${n3}`);
    let i3 = $(r2.totalBytes);
    i3 != null && e3.push(`Израсходовано: ${Rm(i3)}`);
    let a3 = $(r2.measurementDurationMs, r2.totalTimeMs);
    return a3 != null && e3.push(`Длительность: ${Lm(a3 / 1e3, 1)} с`), e3;
  }, [r2]), v2 = $(n2?.percent) ?? (r2 ? 100 : 0), y2 = r2 ? $(r2?.httpsProbeLossPercent, r2?.tcpProbeLossPercent) ?? 0 : null, b2 = String(n2?.phase ?? (r2?.error ? `error` : r2 ? `complete` : `preparing`)), x2 = r2?.error ? Q(r2.error) ?? l2.error : l2[b2] ?? (s2 ? `Выполняется точный замер` : `Замер завершён`);
  return O.useEffect(() => {
    if (t2) {
      o2(true);
      return;
    }
    let e3 = window.setTimeout(() => o2(false), 240);
    return () => window.clearTimeout(e3);
  }, [t2]), O.useEffect(() => {
    if (t2 && !wasOpenRef.current) {
      let e3 = document.activeElement;
      returnFocusRef.current = e3 instanceof HTMLElement ? e3 : null;
      wasOpenRef.current = true;
    }
    if (!t2 && wasOpenRef.current) {
      wasOpenRef.current = false;
      let e3 = returnFocusRef.current;
      returnFocusRef.current = null;
      window.requestAnimationFrame(() => e3?.isConnected && e3.focus({ preventScroll: true }));
    }
  }, [t2]), O.useEffect(() => {
    if (!t2) return;
    let n3 = (t3) => {
      if (t3.key === `Escape`) {
        t3.preventDefault(), e2();
        return;
      }
      if (t3.key !== `Tab` || !p3.current) return;
      let r3 = Array.from(p3.current.querySelectorAll(`button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])`));
      if (r3.length === 0) {
        t3.preventDefault(), p3.current.focus();
        return;
      }
      let i3 = r3[0], a3 = r3[r3.length - 1];
      t3.shiftKey && document.activeElement === i3 ? (t3.preventDefault(), a3.focus()) : !t3.shiftKey && document.activeElement === a3 && (t3.preventDefault(), i3.focus());
    };
    document.addEventListener(`keydown`, n3);
    let focusFrame = window.requestAnimationFrame(() => i2.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(`keydown`, n3);
    };
  }, [e2, t2]), a2 ? (0, V.jsx)(td.div, { animate: t2 ? { opacity: 1 } : { opacity: 0 }, "aria-hidden": !t2, className: `speedtest-overlay`, initial: { opacity: 1 }, onMouseDown: (t3) => {
    t3.currentTarget === t3.target && e2();
  }, style: { pointerEvents: t2 ? `auto` : `none` }, children: (0, V.jsxs)(td.section, { "aria-label": `Результат замера скорости`, "aria-modal": `true`, animate: t2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.975 }, className: `speedtest-panel${s2 ? ` busy` : ``}${r2?.error ? ` error` : ``}`, "data-testid": `speedtest-panel`, initial: { opacity: 1, y: 0, scale: 1 }, ref: p3, role: `dialog`, tabIndex: -1, transition: { type: `spring`, stiffness: 420, damping: 34, mass: 0.72 }, children: [(0, V.jsx)(`button`, { "aria-label": `Скрыть результат замера`, className: `speedtest-close`, onClick: e2, onPointerDown: (t3) => {
    t3.stopPropagation(), e2();
  }, ref: i2, type: `button`, children: (0, V.jsx)(Id, { size: 17 }) }), (0, V.jsxs)(`header`, { className: `speedtest-head`, children: [(0, V.jsx)(`div`, { className: `speedtest-orb${s2 ? ` live` : ` complete`}`, style: { "--speed-angle": `${Math.max(8, v2 * 3.6)}deg` }, children: (0, V.jsx)(`div`, { children: s2 ? (0, V.jsxs)(`strong`, { children: [Math.round(v2), (0, V.jsx)(`small`, { children: `%` })] }) : r2?.error ? (0, V.jsx)(Nd, { size: 25 }) : (0, V.jsx)(ud, { size: 27 }) }) }), (0, V.jsxs)(`div`, { className: `speedtest-title`, children: [(0, V.jsx)(`span`, { children: s2 ? `Точный замер скорости` : r2?.error ? `Замер не завершён` : `Результат замера` }), (0, V.jsx)(`strong`, { children: x2 })] }), (0, V.jsx)(`i`, { "aria-label": `Прогресс ${Math.round(v2)}%`, "aria-valuemax": 100, "aria-valuemin": 0, "aria-valuenow": Math.round(v2), className: `speed-progress${s2 ? `` : r2?.error ? ` failed` : ` complete`}`, role: `progressbar`, children: (0, V.jsx)(`b`, { style: { width: `${v2}%` } }) })] }), (0, V.jsxs)(`div`, { className: `speedtest-metrics`, children: [(0, V.jsx)(xp, { icon: md, label: `Скачивание`, primary: true, value: u2 == null ? `—` : (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(Ap, { format: (e3) => Lm(e3), value: u2 }), ` Мбит/с`] }) }), (0, V.jsx)(xp, { icon: Pd, label: `Отдача`, primary: true, value: d2 == null ? r2?.uploadError ? `Недоступна` : `—` : (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(Ap, { format: (e3) => Lm(e3), value: d2 }), ` Мбит/с`] }) }), (0, V.jsx)(xp, { icon: pd, label: `Задержка`, value: f2 == null ? `—` : (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(Ap, { format: (e3) => Lm(e3, 1), value: f2 }), ` мс`] }) })] }), s2 ? (0, V.jsxs)(`div`, { className: `speedtest-actions`, children: [(0, V.jsx)(`button`, { className: `speedtest-cancel`, onClick: e2, type: `button`, children: `Отменить замер` }), (0, V.jsx)(`span`, { children: `Отмена прекращает передачу данных, а не только скрывает окно.` })] }) : null] }) }) : null;
}
var dp = { protected: { title: `Соединение защищено`, lead: `Windows направляет трафик через выбранное соединение.`, tone: `good` }, partial: { title: `Защита работает частично`, lead: `Часть проверок не подтвердилась. Ниже отмечено, что именно и что можно сделать.`, tone: `warn` }, unprotected: { title: `Защита не работает`, lead: `Соединение установлено, но часть проверок не пройдена. Ниже — что именно не сработало.`, tone: `bad` }, inconclusive: { title: `Проверить не удалось`, lead: `Сеть отвечала нестабильно, поэтому результат не подтверждён ни в одну сторону. Повторите проверку.`, tone: `info` }, not_applicable: { title: `Соединение отключено`, lead: `Проверять защиту пока нечего. Подключитесь на экране «Соединение» — после этого проверка покажет, действительно ли трафик идёт через него.`, tone: `info` } }, fp = [`восстановить интернет`, `повторить проверку`, `применить маршрут заново`, `переподключить соединение`, `выбрать другой сервер`, `открыть настройки dns`, `применить настройки dns заново`];
function pp(e2) {
  return e2.trim().toLowerCase().replace(/[.\s]+$/u, ``);
}
function mp(e2) {
  return fp.includes(pp(e2));
}
var hp = { pass: ud, warn: Nd, fail: Id, skipped: pd };
function gp(e2) {
  let t2 = e2;
  if (!t2 || typeof t2 != `object`) return null;
  let n2 = dp[_p([t2.route ?? null, t2.dns ?? null])] ?? dp.inconclusive, r2 = [...t2.route?.checks ?? [], ...t2.dns?.checks ?? []], i2 = r2.filter((e3) => Q(e3?.status) === `fail`).length, a2 = r2.filter((e3) => Q(e3?.status) === `warn`).length, o2 = [];
  return i2 > 0 && o2.push(`не пройдено: ${i2}`), a2 > 0 && o2.push(`требует внимания: ${a2}`), { tone: n2.tone, title: n2.title, detail: o2.length > 0 ? `${o2.join(`, `)}. Подробности в отчёте.` : n2.lead };
}
function _p(e2) {
  let [t2] = e2;
  if (Q(t2?.verdict) === `not_applicable`) return `not_applicable`;
  let n2 = [`unprotected`, `partial`, `inconclusive`, `protected`, `not_applicable`], r2 = e2.map((e3) => Q(e3?.verdict)).filter((e3) => !!e3);
  if (r2.length === 0) return `inconclusive`;
  for (let e3 of n2) if (r2.includes(e3)) return e3;
  return `inconclusive`;
}
function vp(e2, t2) {
  if (!e2 && !t2) return `Проверить смену выхода, применение маршрута и путь DNS`;
  let n2 = dp[_p([e2, t2])] ?? dp.inconclusive, r2 = [...e2?.checks ?? [], ...t2?.checks ?? []].filter((e3) => e3?.status === `fail`);
  if (r2.length > 0) return `${n2.title}: ${Q(r2[0]?.title) ?? `есть непройденная проверка`}`;
  let i2 = [...e2?.checks ?? [], ...t2?.checks ?? []].filter((e3) => e3?.status === `warn`);
  return i2.length > 0 ? `${n2.title}: ${Q(i2[0]?.title) ?? `часть проверок не подтверждена`}` : n2.title;
}
function yp({ check: e2, onAction: t2 }) {
  let n2 = Q(e2?.status) ?? `skipped`, r2 = hp[n2] ?? pd, i2 = Q(e2?.recommendedAction);
  return (0, V.jsxs)(`li`, { className: `protection-check ${n2}`, children: [(0, V.jsx)(`span`, { "aria-hidden": `true`, className: `protection-check-icon`, children: (0, V.jsx)(r2, { size: 14, strokeWidth: 2.1 }) }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`strong`, { children: Q(e2?.title) ?? `Проверка` }), (0, V.jsx)(`p`, { children: Q(e2?.explanation) ?? `` }), (e2?.observed || e2?.expected) && n2 !== `pass` ? (0, V.jsxs)(`details`, { className: `protection-check-facts`, children: [(0, V.jsx)(`summary`, { children: `Технические подробности` }), (0, V.jsxs)(`dl`, { children: [e2?.observed ? (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(`dt`, { children: `Что увидели` }), (0, V.jsx)(`dd`, { children: e2.observed })] }) : null, e2?.expected ? (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(`dt`, { children: `Что ожидали` }), (0, V.jsx)(`dd`, { children: e2.expected })] }) : null] })] }) : null, i2 && t2 && mp(i2) ? (0, V.jsx)(`button`, { className: `protection-check-action`, onClick: () => t2(i2), type: `button`, children: i2 }) : i2 ? (0, V.jsx)(`em`, { className: `protection-check-hint`, children: i2 }) : null] })] });
}
function bp({ dns: e2, onClose: t2, onProtectionAction: n2, open: r2, route: i2 }) {
  let a2 = O.useRef(null), o2 = O.useRef(null), s2 = O.useRef(null), [c2, l2] = O.useState(r2);
  if (O.useEffect(() => {
    if (r2) {
      l2(true);
      return;
    }
    let e3 = window.setTimeout(() => l2(false), 220);
    return () => window.clearTimeout(e3);
  }, [r2]), O.useEffect(() => {
    if (!r2) return;
    o2.current = document.activeElement;
    let e3 = (e4) => {
      if (e4.key === `Escape`) {
        t2();
        return;
      }
      if (e4.key !== `Tab`) return;
      let n3 = s2.current?.querySelectorAll(`button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`);
      if (!n3 || n3.length === 0) return;
      let r3 = n3[0], i3 = n3[n3.length - 1];
      e4.shiftKey && document.activeElement === r3 ? (e4.preventDefault(), i3.focus()) : !e4.shiftKey && document.activeElement === i3 && (e4.preventDefault(), r3.focus());
    };
    return document.addEventListener(`keydown`, e3), window.requestAnimationFrame(() => a2.current?.focus()), () => {
      document.removeEventListener(`keydown`, e3), o2.current?.focus?.();
    };
  }, [t2, r2]), !c2) return null;
  let u2 = _p([i2, e2]), d2 = dp[u2] ?? dp.inconclusive, f2 = i2?.checks ?? [], p2 = e2?.checks ?? [], m2 = [.../* @__PURE__ */ new Set([...i2?.limitations ?? [], ...e2?.limitations ?? []])], h2 = Q(i2?.error, e2?.error), g2 = Q(i2?.testedAt, e2?.testedAt), _2 = (e3) => {
    n2?.(e3);
  };
  return (0, V.jsx)(td.div, { animate: r2 ? { opacity: 1 } : { opacity: 0 }, "aria-hidden": !r2, className: `speedtest-overlay`, initial: { opacity: 1 }, onMouseDown: (e3) => {
    e3.currentTarget === e3.target && t2();
  }, style: { pointerEvents: r2 ? `auto` : `none` }, children: (0, V.jsxs)(td.section, { animate: r2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.98 }, "aria-label": `Отчёт о защите маршрута`, "aria-modal": `true`, className: `protection-panel ${d2.tone}`, "data-testid": `protection-panel`, initial: { opacity: 1, y: 0, scale: 1 }, ref: s2, role: `dialog`, transition: Of, children: [(0, V.jsx)(`button`, { "aria-label": `Закрыть отчёт о защите`, className: `speedtest-close`, onClick: t2, ref: a2, type: `button`, children: (0, V.jsx)(Id, { size: 17 }) }), (0, V.jsxs)(`header`, { className: `protection-head`, children: [(0, V.jsx)(`span`, { className: `protection-verdict ${d2.tone}`, children: u2 === `protected` ? (0, V.jsx)(Ad, { size: 22 }) : u2 === `unprotected` ? (0, V.jsx)(Id, { size: 22 }) : u2 === `not_applicable` ? (0, V.jsx)(dd, { size: 22 }) : (0, V.jsx)(Nd, { size: 22 }) }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`strong`, { children: d2.title }), (0, V.jsx)(`span`, { children: d2.lead })] })] }), h2 && f2.length === 0 && p2.length === 0 ? (0, V.jsx)(`p`, { className: `protection-empty`, children: h2 }) : null, f2.length > 0 ? (0, V.jsxs)(`section`, { children: [(0, V.jsx)(`h4`, { children: `Путь трафика` }), (0, V.jsx)(`ul`, { className: `protection-checks`, children: f2.map((e3, t3) => (0, V.jsx)(yp, { check: e3, onAction: _2 }, Q(e3?.id) ?? t3)) })] }) : null, p2.length > 0 ? (0, V.jsxs)(`section`, { children: [(0, V.jsx)(`h4`, { children: `Как разрешаются адреса сайтов` }), (0, V.jsx)(`ul`, { className: `protection-checks`, children: p2.map((e3, t3) => (0, V.jsx)(yp, { check: e3, onAction: _2 }, Q(e3?.id) ?? t3)) })] }) : null, m2.length > 0 ? (0, V.jsxs)(`section`, { className: `protection-limits`, children: [(0, V.jsx)(`h4`, { children: `Что эта проверка не показывает` }), (0, V.jsx)(`ul`, { children: m2.map((e3) => (0, V.jsx)(`li`, { children: e3 }, e3)) })] }) : null, g2 ? (0, V.jsxs)(`footer`, { className: `protection-foot`, children: [`Проверено: `, Fm(g2)] }) : null] }) });
}
function xp({ accent: e2 = false, details: t2 = [], icon: n2, label: r2, primary: i2 = false, value: a2 }) {
  return (0, V.jsxs)(td.div, { animate: { opacity: 1, y: 0 }, className: `speed-metric${i2 ? ` primary` : ``}${e2 ? ` accent` : ``}`, initial: { opacity: 0, y: 8 }, transition: { type: `spring`, stiffness: 420, damping: 32 }, children: [(0, V.jsxs)(`span`, { children: [(0, V.jsx)(n2, { size: 15, strokeWidth: 1.8 }), r2] }), (0, V.jsx)(`strong`, { children: a2 }), t2.length > 0 ? (0, V.jsx)(`div`, { children: t2.map((e3) => (0, V.jsx)(`em`, { children: e3 }, e3)) }) : null] });
}
function Sp({ runAction: e2, snapshot: t2 }) {
  let [n2, r2] = O.useState(`ping`), [i2, a2] = O.useState({}), o2 = O.useMemo(() => pm(t2.state?.nodes), [t2.state?.nodes]), s2 = O.useMemo(() => o2.map((e3) => `${e3.id}:${e3.server}:${e3.port}`).join(`|`), [o2]), c2 = Array.isArray(t2.state?.subscriptions) ? t2.state.subscriptions : [], l2 = Q(t2.vpn?.activeNodeId, t2.state?.activeNodeId), u2 = o2.find((e3) => e3.id === l2) ?? null, d2 = c2[0] ?? null, f2 = fm(t2.vpn, t2.state) ?? Q(d2?.name, d2?.provider, bm(d2?.url)) ?? `Провайдер не определён`, p2 = Sm(d2?.expire), m2 = Cm(d2), h2 = d2 ? o2.filter((e3) => Q((Array.isArray(t2.state?.nodes) ? t2.state.nodes.find((t3) => String(t3?.id ?? ``) === e3.id) : null)?.subscriptionId) === Q(d2.id)).length : o2.length, g2 = xm(d2) && o2.length > 0 && h2 > 0, _2 = O.useMemo(() => {
    let e3 = [...o2];
    return e3.sort((e4, t3) => {
      let r3 = Number(t3.favorite) - Number(e4.favorite);
      return r3 === 0 ? n2 === `name` ? e4.name.localeCompare(t3.name, `ru`) : n2 === `country` ? e4.country.localeCompare(t3.country, `ru`) || e4.name.localeCompare(t3.name, `ru`) : ((i2[e4.id] != null && i2[e4.id] > 0 ? i2[e4.id] : 999999) - (i2[t3.id] != null && i2[t3.id] > 0 ? i2[t3.id] : 999999)) || e4.name.localeCompare(t3.name, `ru`) : r3;
    }), e3;
  }, [o2, i2, n2]);
  O.useEffect(() => {
    let e3 = false, t3 = false, batchOffset = 0, n3 = async () => {
      if (t3 || !o2.length) return;
      t3 = true;
      let n4 = Math.min(60, o2.length), r3 = batchOffset % o2.length;
      batchOffset = (r3 + n4) % o2.length;
      let i3 = r3 + n4 <= o2.length ? o2.slice(r3, r3 + n4) : [...o2.slice(r3), ...o2.slice(0, r3 + n4 - o2.length)];
      try {
        let t4 = await Promise.allSettled(i3.map(async (e4) => {
          let t5 = await Z(`system.ping`, window.egoistAPI?.system?.ping, e4.server, e4.port, 1800);
          return [e4.id, Number.isFinite(t5) && t5 > 0 ? Math.round(t5) : -1];
        }));
        if (e3) return;
        a2((e4) => {
          let n5 = { ...e4 };
          for (let e5 of t4) e5.status === `fulfilled` && (n5[e5.value[0]] = e5.value[1]);
          return n5;
        });
      } finally {
        t3 = false;
      }
    };
    n3();
    let r3 = window.setTimeout(n3, 900), i3 = window.setInterval(n3, 1e4);
    return () => {
      e3 = true, window.clearTimeout(r3), window.clearInterval(i3);
    };
  }, [s2]);
  let v2 = (e3) => {
    let n3 = t2.state;
    return n3 ? Z(`state.set`, window.egoistAPI?.state?.set, { ...n3, activeNodeId: e3 }) : Promise.resolve(null);
  }, y2 = (e3) => {
    let n3 = t2.state;
    if (!n3) return Promise.resolve(null);
    let r3 = (Array.isArray(n3.nodes) ? n3.nodes : []).map((t3) => {
      if (t3.id !== e3) return t3;
      let n4 = String(t3?.metadata?.favorite ?? ``) === `true`;
      return { ...t3, metadata: { ...t3.metadata ?? {}, favorite: n4 ? `false` : `true` } };
    });
    return Z(`state.set`, window.egoistAPI?.state?.set, { ...n3, nodes: r3 });
  }, b2 = O.useCallback(() => e2(`vpn-import`, async () => {
    let e3 = await Z(`system.readClipboard`, window.egoistAPI?.system?.readClipboard), t3 = String(e3 ?? ``).trim();
    if (!t3) throw Error(`Буфер обмена пуст.`);
    let n3 = await Z(`import.text`, window.egoistAPI?.import?.text, t3), r3 = $(n3?.added) ?? 0, i3 = $(n3?.subscriptionsAdded) ?? 0;
    if (r3 <= 0 && i3 <= 0) {
      let e4 = Array.isArray(n3?.issues) ? n3.issues[0] : null;
      throw Error(Q(e4) ?? `Не найдено поддерживаемых серверов или подписок.`);
    }
    return n3;
  }, `Импорт выполнен`), [e2]), x2 = O.useCallback(() => e2(`subscription-refresh`, async () => {
    let e3 = await Z(`subscription.refreshAll`, window.egoistAPI?.subscription?.refreshAll), t3 = $(e3?.added) ?? 0, n3 = Array.isArray(e3?.issues) ? e3.issues : [];
    if (o2.length === 0 && t3 <= 0 && n3.length > 0) throw Error(Q(n3[0]) ?? `Subscription refresh failed.`);
    return e3;
  }, `Подписки обновлены`), [o2.length, e2]), S2 = O.useCallback(() => {
    let t3 = Q(d2?.url);
    return t3 ? e2(`subscription-delete`, async () => {
      let e3 = await Z(`subscription.delete`, window.egoistAPI?.subscription?.delete, t3);
      if (!e3) throw Error(`Подписка не найдена.`);
      return e3;
    }, `Подписка удалена`) : Promise.resolve(null);
  }, [d2?.url, e2]);
  return O.useEffect(() => {
    let e3 = (e4) => {
      e4.defaultPrevented || e4.key.toLowerCase() !== `v` || !e4.ctrlKey && !e4.metaKey || Cp(e4.target) || (e4.preventDefault(), b2());
    };
    return window.addEventListener(`keydown`, e3), () => window.removeEventListener(`keydown`, e3);
  }, [b2]), (0, V.jsxs)(`div`, { className: `vpn-layout`, children: [(0, V.jsxs)(Mp, { className: `vpn-servers-panel`, children: [(0, V.jsxs)(`div`, { className: `vpn-panel-head`, children: [(0, V.jsxs)(`div`, { children: [(0, V.jsx)(Np, { children: `Серверы` }), (0, V.jsx)(`span`, { children: o2.length ? `${o2.length} серверов из подписки` : `Серверы ещё не добавлены` })] }), (0, V.jsxs)(`div`, { className: `vpn-head-actions`, children: [(0, V.jsx)(`button`, { className: `btn-primary compact`, "data-testid": `vpn-import-clipboard`, type: `button`, onClick: () => void b2(), children: `Импорт` }), (0, V.jsxs)(`label`, { children: [(0, V.jsx)(`span`, { children: `Сортировка` }), (0, V.jsxs)(`select`, { className: `input`, value: n2, onChange: (e3) => r2(e3.target.value), children: [(0, V.jsx)(`option`, { value: `ping`, children: `По пингу` }), (0, V.jsx)(`option`, { value: `country`, children: `По стране` }), (0, V.jsx)(`option`, { value: `name`, children: `По названию` })] })] })] })] }), (0, V.jsx)(`div`, { className: `vpn-server-list`, children: _2.length ? _2.map((t3) => {
    let n3 = i2[t3.id];
    return (0, V.jsxs)(`article`, { className: l2 === t3.id ? `vpn-server-row active` : `vpn-server-row`, "data-node-id": t3.id, children: [(0, V.jsx)(`button`, { "aria-label": t3.favorite ? `Убрать ${t3.name} из избранного` : `Добавить ${t3.name} в избранное`, "aria-pressed": t3.favorite, className: t3.favorite ? `favorite-button active` : `favorite-button`, type: `button`, onClick: () => void e2(`vpn-favorite`, () => y2(t3.id), `Избранное обновлено`), children: (0, V.jsx)(Md, { "aria-hidden": `true`, size: 15 }) }), (0, V.jsx)(`span`, { className: `vpn-country-flag`, children: (0, V.jsx)(Lp, { countryCode: t3.countryCode }) }), (0, V.jsxs)(`button`, { className: `vpn-server-main`, type: `button`, onClick: () => void e2(`vpn-favorite`, () => v2(t3.id), `Сервер выбран`), children: [(0, V.jsx)(`strong`, { children: t3.name }), (0, V.jsxs)(`span`, { children: [(0, V.jsx)(xd, { "aria-hidden": `true`, size: 12 }), ` `, t3.country, t3.city ? `, ${t3.city}` : ``, ` · `, t3.protocol.toUpperCase()] })] }), (0, V.jsx)(`span`, { className: n3 == null ? `vpn-server-ping pending` : n3 < 0 ? `vpn-server-ping offline` : n3 < 100 ? `vpn-server-ping good` : n3 < 180 ? `vpn-server-ping warn` : `vpn-server-ping bad`, children: n3 == null ? `...` : n3 < 0 ? `—` : `${n3} мс` }), (0, V.jsx)(`button`, { className: `btn-primary compact`, type: `button`, onClick: () => void e2(`vpn-connect-node`, () => Z(`vpn.connect`, window.egoistAPI?.vpn?.connect, t3.id), `Подключение к ${t3.name} запущено`), children: `Подключить` })] }, t3.id);
  }) : (0, V.jsxs)(`div`, { className: `vpn-empty`, children: [(0, V.jsx)(Ad, { size: 28 }), (0, V.jsx)(`strong`, { children: `Нет серверов` }), (0, V.jsx)(`span`, { children: `Импортируй подписку или конфиг, и здесь появятся реальные узлы с live ping.` })] }) })] }), (0, V.jsxs)(`div`, { className: `vpn-side-stack`, children: [(0, V.jsxs)(Mp, { className: `vpn-subscription-panel`, children: [(0, V.jsx)(Np, { children: `Подписка` }), (0, V.jsxs)(`div`, { className: `subscription-status`, children: [(0, V.jsx)(Fp, { tone: g2 ? `good` : `warn` }), (0, V.jsx)(`strong`, { children: g2 ? `Подписка активна` : d2 ? `Нет серверов` : `Требует импорта` })] }), (0, V.jsxs)(`div`, { className: `kv-list`, children: [(0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Провайдер` }), (0, V.jsx)(`strong`, { children: f2 })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Заканчивается` }), (0, V.jsx)(`strong`, { children: p2 })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Трафик` }), (0, V.jsx)(`strong`, { children: m2 })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Последнее обновление` }), (0, V.jsx)(`strong`, { children: Fm(d2?.lastUpdated) })] })] }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void x2(), children: `Обновить подписку` }), (0, V.jsx)(`button`, { className: `btn-danger full`, disabled: !d2, type: `button`, onClick: () => void S2(), children: `Удалить подписку` })] }), (0, V.jsxs)(Mp, { className: `vpn-provider-panel`, children: [(0, V.jsx)(Np, { children: `Активный маршрут` }), (0, V.jsxs)(`div`, { className: `kv-list`, children: [(0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Сервер` }), (0, V.jsx)(`strong`, { children: dm(t2.vpn, t2.state) })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Провайдер` }), (0, V.jsx)(`strong`, { children: f2 })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Страна` }), (0, V.jsx)(`strong`, { children: u2 ? `${u2.country}${u2.city ? `, ${u2.city}` : ``}` : `Узел не выбран` })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Runtime` }), (0, V.jsx)(`strong`, { children: Q(t2.vpn?.runtimeKind) ?? `не запущен` })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Состояние` }), (0, V.jsx)(`strong`, { children: wm(t2.vpn) ? `Маршрут проверен` : t2.vpn?.connected ? `Проверяется` : `Отключён` })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Внешний IP` }), (0, V.jsx)(`strong`, { children: wm(t2.vpn) ? Q(t2.vpn?.egressIp) ?? `подтверждён` : `не подтверждён` })] }), (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: `Пинг` }), (0, V.jsx)(`strong`, { children: wm(t2.vpn) ? `${$(t2.vpn?.pingMs, t2.health?.pingMs) ?? `...`} мс` : `Соединение отключено` })] })] })] })] })] });
}
function Cp(e2) {
  if (!(e2 instanceof HTMLElement)) return false;
  if (e2.isContentEditable) return true;
  let t2 = e2.tagName.toLowerCase();
  return t2 === `input` || t2 === `textarea` || t2 === `select`;
}
function wp({ confirmAction: e2, refreshDnsDiagnostics: t2, runAction: n2, snapshot: r2 }) {
  let [i2, a2] = O.useState(zf.manualPrimary), [o2, s2] = O.useState(zf.manualSecondary), [c2, l2] = O.useState(r2.state?.settings?.systemDohUrl ?? ``), u2 = O.useRef(false);
  O.useEffect(() => {
    u2.current || (u2.current = true, t2());
  }, [t2]);
  let d2 = O.useCallback(async (e3) => {
    let n3 = await e3();
    return window.setTimeout(() => {
      t2();
    }, 120), n3;
  }, [t2]), f2 = O.useMemo(() => jm(c2), [c2]), p2 = r2.systemDoh?.running === true, m2 = r2.systemDoh?.nativeManaged === true, h2 = !!r2.systemDoh?.serviceInstalled, g2 = !!r2.systemDoh?.serviceRunning, _2 = m2 ? p2 ? `Windows DNS Client · проверен` : `Windows DNS Client · выключен` : h2 ? g2 ? r2.systemDoh?.verified === false ? `Запущена, DNS не подтверждён` : `Работает · автозапуск` : `Установлена · остановлена` : `Не установлена`, v2 = r2.dns?.mode === `gravityless-dns` || Q(r2.state?.settings?.systemDnsServers)?.includes(`127.0.0.1`), y2 = Q(r2.systemDoh?.currentUrl, r2.systemDoh?.url, r2.state?.settings?.systemDohUrl, f2?.dohUrl), b2 = r2.dnsCheck?.current ?? null, x2 = Q(b2?.address, b2?.server, r2.dnsCheck?.resolverIp, r2.dnsCheck?.dns?.primary, r2.dnsCheck?.dns?.server, r2.dnsCheck?.dns?.servers?.[0], r2.dns?.servers?.[0], r2.dns?.server, r2.dns?.currentServer, r2.systemDoh?.server, r2.state?.settings?.systemDnsServers), S2 = Q(b2?.provider, r2.dnsCheck?.provider, r2.dnsCheck?.dns?.provider, r2.dns?.provider, r2.systemDoh?.provider, Nm(x2), y2 ? Nm(y2) : null), C2 = Q(b2?.country, r2.dnsCheck?.country, r2.dnsCheck?.ip?.country, r2.dnsCheck?.ip?.countryCode, r2.dns?.country, r2.systemDoh?.country), ee2 = Q(b2?.statusLabel, b2?.status) ?? Pm(r2.dns, r2.systemDoh), te2 = Jd({ mode: Q(b2?.mode, r2.dns?.mode) ?? `system-default`, active: b2?.status === `active` || b2?.statusLabel === `Активен` || r2.dns?.running === true || p2, nativeManaged: m2, backgroundServiceRunning: g2 }), ne2 = Q(b2?.protocol) ?? (p2 ? m2 ? `System DoH (Windows)` : `System DoH` : v2 ? `Локальный DNS` : r2.dns?.mode ?? `System DNS`), re2 = Q(b2?.localChannel) ?? (p2 && m2 ? `Windows DNS Client · HTTPS:443` : p2 || v2 ? `${zf.localAddress}:${zf.localPort}` : `не активен`), ie2 = typeof b2?.encrypted == `boolean` ? b2.encrypted : p2, ae2 = r2.dnsCheck?.summary ?? null, oe2 = Array.isArray(r2.dnsCheck?.targets) ? r2.dnsCheck.targets : [], se2 = $(ae2?.averagePingMs, r2.dnsCheck?.pingMs, r2.dns?.pingMs, r2.dns?.leakStatus?.pingMs, r2.health?.dnsPingMs), ce2 = $(ae2?.averageDnsMs, r2.dnsCheck?.responseMs, r2.dns?.responseMs, r2.dns?.leakStatus?.responseMs, r2.systemDoh?.responseMs), w2 = typeof ae2?.okCount == `number` && typeof ae2?.total == `number` ? `${ae2.okCount}/${ae2.total}` : `не проверено`;
  return (0, V.jsxs)(`div`, { className: `dns-layout`, children: [(0, V.jsxs)(Mp, { className: `dns-form`, children: [(0, V.jsx)(Np, { children: `Ручная настройка DNS` }), (0, V.jsx)(`div`, { className: `preset-grid`, children: Vf.map((e3) => (0, V.jsxs)(`button`, { className: `preset-button`, onClick: () => {
    a2(e3.servers[0]), s2(e3.servers[1]);
  }, type: `button`, children: [(0, V.jsx)(`strong`, { children: e3.name }), (0, V.jsx)(`span`, { children: e3.note })] }, e3.id)) }), (0, V.jsxs)(`div`, { className: `dns-inputs-row`, children: [(0, V.jsx)(Bp, { label: `Основной DNS`, value: i2, onChange: a2 }), (0, V.jsx)(Bp, { label: `Дополнительный DNS`, value: o2, onChange: s2 })] }), (0, V.jsxs)(`div`, { className: `button-row`, children: [(0, V.jsx)(`button`, { className: `btn-primary`, type: `button`, onClick: () => e2(`Установить DNS`, `DNS будет применен к активным физическим адаптерам Windows.`, `Установить`, () => n2(`dns-apply`, () => d2(() => Z(`system.setDnsServers`, window.egoistAPI?.system?.setDnsServers, `${i2}
${o2}`)), `DNS применен`)), children: `Установить` }), (0, V.jsx)(`button`, { className: `btn-secondary`, type: `button`, onClick: () => e2(`Сбросить DNS`, `Windows вернется к DNS по умолчанию/DHCP.`, `Сбросить`, () => n2(`dns-reset`, () => d2(() => Z(`system.resetDnsServers`, window.egoistAPI?.system?.resetDnsServers)), `DNS сброшен`)), children: `Сбросить` })] }), (0, V.jsxs)(`div`, { className: `dns-link-card`, children: [(0, V.jsxs)(`div`, { className: `dns-link-head`, children: [(0, V.jsx)(Np, { children: `DNS-ссылка` }), (0, V.jsx)(`span`, { children: `DoH URL / DoT hostname` })] }), (0, V.jsxs)(`label`, { className: `field-label`, children: [(0, V.jsx)(`span`, { children: `Одна DNS-строка` }), (0, V.jsx)(`textarea`, { className: `input dns-link-input`, "data-testid": `dns-link-input`, onChange: (e3) => l2(e3.target.value), placeholder: `https://cloudflare-dns.com/dns-query`, value: c2 })] }), (0, V.jsx)(`div`, { className: f2 ? `dns-link-preview` : `dns-link-preview empty`, children: f2 ? (0, V.jsxs)(`div`, { className: `dns-preview-inline`, children: [(0, V.jsx)(`span`, { className: `dns-preview-badge`, children: f2.protocol }), (0, V.jsx)(`strong`, { children: f2.provider }), (0, V.jsx)(`span`, { className: `dns-preview-endpoint`, children: f2.displayEndpoint })] }) : (0, V.jsx)(`p`, { children: `Вставьте DoH URL или Android Private DNS hostname.` }) }), (0, V.jsxs)(`div`, { className: `button-row even`, children: [(0, V.jsx)(`button`, { className: `btn-secondary`, type: `button`, onClick: () => void n2(`dns-link-paste`, async () => {
    let e3 = await Z(`system.readClipboard`, window.egoistAPI?.system?.readClipboard);
    return l2(String(e3 ?? ``)), { ok: true };
  }, `DNS-ссылка вставлена`), children: `Вставить` }), (0, V.jsx)(`button`, { className: `btn-primary`, "data-testid": `dns-link-apply`, disabled: !f2 || r2.busy === `dns-link-apply`, type: `button`, onClick: () => void n2(`dns-link-apply`, () => {
    let e3 = jm(c2);
    if (!e3) throw Error(`Вставьте корректный HTTPS-адрес DoH или поддерживаемый DoT hostname.`);
    return d2(() => Z(`system.applySystemDoh`, window.egoistAPI?.system?.applySystemDoh, e3.dohUrl));
  }, `DNS-ссылка подключена`), children: `Подключить ссылку` })] }), (0, V.jsxs)(`div`, { className: p2 || h2 ? `button-row even` : ``, children: [p2 || h2 ? (0, V.jsx)(`button`, { className: `btn-secondary`, "data-testid": `doh-service-restart`, type: `button`, onClick: () => void n2(`doh-restart`, () => d2(() => Z(`system.restartSystemDoh`, window.egoistAPI?.system?.restartSystemDoh)), `System DoH перепроверен`), children: `Перепроверить DoH` }) : null, (0, V.jsx)(`button`, { className: `btn-danger full`, "data-testid": `doh-service-remove`, type: `button`, onClick: () => e2(`Отключить System DoH`, `Egoist Lagom вернёт исходные DNS и DoH-записи. Чужие настройки и другие фоновые службы останутся без изменений.`, `Отключить`, () => n2(`doh-reset`, () => d2(() => Z(`system.resetSystemDoh`, window.egoistAPI?.system?.resetSystemDoh)), `DNS-ссылка отключена`)), children: `Отключить DoH` })] })] })] }), (0, V.jsxs)(`div`, { className: `side-stack`, children: [(0, V.jsxs)(Mp, { className: `dns-current-panel`, children: [(0, V.jsx)(Np, { children: `Текущий DNS` }), (0, V.jsx)(Wp, { rows: [[`Адрес`, x2 ?? `Не прочитан`], [`Провайдер`, S2 ?? `Не определён`], [`Страна`, C2 ?? `Не определена`], [`Протокол`, ne2], [`Локальный канал`, re2], [`Фоновая служба`, _2], [`Работает без приложения`, te2 ? `Да` : `Нет`], [`Шифрование`, ie2 ? `Включено` : `Выключено`], [`Статус`, ee2]] })] }), (0, V.jsxs)(Mp, { className: `dns-check-panel`, children: [(0, V.jsx)(Np, { children: `Проверка` }), (0, V.jsx)(Wp, { rows: [[`Средний пинг`, se2 == null ? `не проверен` : `${se2} мс`], [`DNS response`, ce2 == null ? `не проверено` : `${ce2} мс`], [`Успешно`, w2]] }), (0, V.jsx)(`div`, { className: `dns-targets`, role: `list`, children: (oe2.length > 0 ? oe2 : Hf).map((e3) => {
    let t3 = $(e3.pingMs, e3.tcpMs), n3 = $(e3.dnsMs), r3 = e3.ok === true ? `good` : e3.ok === false ? `bad` : `idle`, i3 = r3 === `good` ? `${e3.host} · имя разрешено за ${n3 ?? `?`} мс, соединение установлено за ${t3 ?? `?`} мс` : r3 === `bad` ? `${e3.host} · ${Q(e3.error) ?? `доступ не подтверждён`}` : `${e3.host} · проверка ещё не запускалась`;
    return (0, V.jsxs)(`div`, { className: `dns-target ${r3}`, role: `listitem`, title: i3, children: [(0, V.jsx)(`span`, { className: `dns-target-name`, children: e3.label ?? e3.host }), (0, V.jsx)(`span`, { className: `dns-target-value`, children: r3 === `good` ? (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(`strong`, { children: t3 ?? `—` }), (0, V.jsx)(`em`, { children: `мс` })] }) : (0, V.jsx)(`em`, { className: `dns-target-state`, children: r3 === `bad` ? `нет доступа` : `не проверен` }) }), (0, V.jsx)(`span`, { "aria-hidden": `true`, className: `dns-target-bar` })] }, e3.host);
  }) }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void n2(`dns-check`, async () => Z(`system.dnsDiagnostics`, window.egoistAPI?.system?.dnsDiagnostics), `DNS проверен`), children: `Проверить DNS` })] })] })] });
}
function Tp({ activity: e2, confirmAction: t2, runAction: n2, snapshot: r2 }) {
  let [i2, a2] = O.useState(r2.zapret?.currentProfile ?? r2.zapret?.currentProfileName ?? ``), o2 = !!r2.zapret?.serviceRunning, s2 = !!r2.zapret?.standaloneRunning, c2 = zm(r2.zapret, r2.zapretProfiles, r2.zapretAutoSelect), l2 = c2[0]?.name ?? ``, [u2, d2] = O.useState(`history`), [f2, p2] = O.useState(null), [m2, h2] = O.useState(String(r2.zapret?.gameFilterMode ?? `all`)), [g2, _2] = O.useState(String(r2.zapret?.ipsetMode ?? `none`)), [v2, y2] = O.useState(null), [b2, x2] = O.useState(Uf), [S2, C2] = O.useState(false), [ee2, te2] = O.useState(false), [ne2, re2] = O.useState(Date.now()), [ie2, ae2] = O.useState(null), oe2 = r2.zapretProgress, se2 = String(oe2?.phase ?? ``), ce2 = se2 === `complete` || se2 === `cancelled`, w2 = e2?.id === `zapret-auto` && e2.tone !== `good` && !ce2, T2 = S2 || w2 || r2.busy === `zapret-auto` && !ce2 || !!(se2 && !ce2), le2 = T2 ? null : se2 === `complete` ? Q(oe2?.bestProfile, r2.zapretAutoSelect?.bestProfile) : r2.zapretAutoSelect?.cancelled === true ? null : Q(r2.zapretAutoSelect?.bestProfile), ue2 = o2 || s2, de2 = Q(r2.zapret?.startedAt, r2.zapret?.serviceStartedAt, r2.zapret?.standaloneStartedAt, r2.zapret?.processStartedAt);
  O.useEffect(() => {
    !i2 && l2 && a2(l2);
  }, [l2, i2]), O.useEffect(() => {
    le2 && a2(le2);
  }, [le2]), O.useEffect(() => {
    if (!ue2 && !T2) return;
    re2(Date.now());
    let e3 = window.setInterval(() => re2(Date.now()), 1e3);
    return () => window.clearInterval(e3);
  }, [T2, ue2]), O.useEffect(() => {
    T2 || te2(false);
  }, [T2]), O.useEffect(() => {
    if (!ue2 || de2) {
      ae2(null);
      return;
    }
    ae2((e3) => e3 ?? Date.now());
  }, [de2, ue2]), O.useEffect(() => {
    h2(String(r2.zapret?.gameFilterMode ?? `all`)), _2(String(r2.zapret?.ipsetMode ?? `none`));
  }, [r2.zapret?.gameFilterMode, r2.zapret?.ipsetMode]), O.useEffect(() => {
    let e3 = true;
    return window.egoistAPI?.zapret?.getUserLists?.().then((t3) => {
      e3 && x2(Vm(t3));
    }).catch(() => void 0), () => {
      e3 = false;
    };
  }, []);
  let E2 = i2 || l2, fe2 = c2.length > 0, D2 = typeof r2.busy == `string` && r2.busy.startsWith(`zapret`), pe2 = Q(oe2?.profile), me2 = Tm(oe2), he2 = pe2 ?? E2, ge2 = T2 ? me2.detail : D2 ? `Запускается` : ue2 ? `Работает` : `Не работает`, _e2 = T2 ? Im(oe2?.startedAt, ne2) : ue2 ? Im(de2 ?? ie2 ?? r2.zapret?.uptimeMs ?? r2.zapret?.runtimeMs, ne2) : `—`, ve2 = zapretHistoryRows(r2.zapretAutoSelect);
  return (0, V.jsxs)(`div`, { className: `zapret-layout`, children: [(0, V.jsxs)(Mp, { className: `config-list`, children: [(0, V.jsx)(Np, { children: `Профили` }), (0, V.jsxs)(`div`, { "aria-label": `Статусы проверки профилей`, className: `config-legend`, role: `group`, children: [(0, V.jsxs)(`span`, { children: [(0, V.jsx)(Fp, { tone: `good` }), `Успешно`] }), (0, V.jsxs)(`span`, { children: [(0, V.jsx)(Fp, { tone: `bad` }), `Ошибка`] }), (0, V.jsxs)(`span`, { children: [(0, V.jsx)(Fp, { tone: `idle` }), `Не проверен`] })] }), (0, V.jsx)(`div`, { className: `config-scroll`, children: fe2 ? c2.map((e3) => (0, V.jsxs)(`button`, { className: E2 === e3.name ? `config-row active` : `config-row`, onClick: () => a2(e3.name), type: `button`, children: [(0, V.jsxs)(`span`, { children: [(0, V.jsx)(`strong`, { children: e3.name }), (0, V.jsx)(`em`, { children: e3.detail })] }), (0, V.jsxs)(`span`, { className: `config-row-status`, title: Ip(e3.tone), children: [(0, V.jsx)(Fp, { tone: e3.tone }), (0, V.jsx)(`span`, { className: `sr-only`, children: Ip(e3.tone) })] })] }, e3.name)) : (0, V.jsxs)(`div`, { className: `empty-table-state compact-empty`, children: [(0, V.jsx)(bd, { size: 17 }), (0, V.jsx)(`span`, { children: `Профили маршрутов ещё не загружены` })] }) }), (0, V.jsxs)(`div`, { className: `config-actions`, children: [(0, V.jsx)(`button`, { className: `btn-primary full`, "data-testid": `zapret-auto`, type: `button`, onClick: () => {
    C2(true), n2(`zapret-auto`, () => Z(`zapret.autoSelect`, window.egoistAPI?.zapret?.autoSelect), `Автоподбор завершен`).finally(() => C2(false));
  }, children: `Автоподбор` }), T2 ? (0, V.jsx)(`button`, { className: `btn-secondary full`, "data-testid": `zapret-auto-cancel`, disabled: ee2, type: `button`, onClick: () => {
    te2(true), Z(`zapret.cancelAutoSelect`, window.egoistAPI?.zapret?.cancelAutoSelect).catch(() => te2(false));
  }, children: ee2 ? `Останавливаю…` : `Отменить автоподбор` }) : null, (0, V.jsx)(`button`, { className: `btn-secondary full`, "data-testid": `zapret-start`, disabled: !E2, type: `button`, onClick: () => t2(`Запустить профиль`, `Профиль запустится как обычный процесс приложения и остановится вместе с ним. Для постоянной работы используйте «Запустить службу».`, `Запустить`, () => n2(`zapret-standalone`, () => Z(`zapret.startStandalone`, window.egoistAPI?.zapret?.startStandalone, E2), `Zapret запущен`)), children: `Запустить` }), (0, V.jsx)(`button`, { className: `btn-secondary full`, "data-testid": `zapret-service-start`, disabled: !E2, type: `button`, onClick: () => t2(`Запустить службу Zapret`, `Профиль будет закреплён за собственной службой EgoistShieldZapret: профиль продолжит работать в фоне и переживёт перезагрузку.`, `Запустить`, () => n2(`zapret-service-start`, async () => {
    if (window.egoistAPI?.zapret?.installService) {
      return await Z(`zapret.installService`, window.egoistAPI.zapret.installService, E2);
    }
    if (window.egoistAPI?.zapret?.setServiceProfile) {
      await Z(`zapret.setServiceProfile`, window.egoistAPI.zapret.setServiceProfile, E2);
    }
    return await Z(`zapret.startService`, window.egoistAPI?.zapret?.startService);
  }, `Служба Zapret запущена`)), children: `Служба` }), (0, V.jsx)(`button`, { className: `btn-danger full`, "data-testid": `zapret-remove`, type: `button`, onClick: () => t2(`Удалить службу Zapret`, `Будет удалена только собственная служба EgoistShieldZapret. Профиль перестанет запускаться автоматически после перезагрузки.

Чужие службы и драйверы не затрагиваются.`, `Удалить`, () => n2(`zapret-remove`, () => Z(`zapret.removeService`, window.egoistAPI?.zapret?.removeService), `Служба Zapret удалена`)), children: `Удалить службу` }), (0, V.jsx)(`button`, { className: `btn-secondary full`, "data-testid": `zapret-clean-cache`, type: `button`, onClick: () => t2(`Очистить кэш всех Discord-клиентов`, `Будут закрыты Discord, Discord PTB, Discord Canary и Vesktop, затем очищен только Electron cache. Учётки и Local Storage не трогаются.`, `Очистить`, () => n2(`zapret-clean-cache`, () => Z(`zapret.cleanDiscordCache`, window.egoistAPI?.zapret?.cleanDiscordCache, `all`), `Кеш всех Discord-клиентов очищен`)), children: `Кэш Discord` }), (0, V.jsx)(`button`, { className: `btn-danger full`, "data-testid": `zapret-reset`, type: `button`, onClick: () => t2(`Сбросить WinDriver / WinWS`, `EgoistShield остановит только собственные процессы и службы Zapret и переустановит драйвер WinDivert. Другие профили и драйверы не затрагиваются.`, `Сбросить`, () => n2(`zapret-reset`, () => Z(`zapret.resetNetworkState`, window.egoistAPI?.zapret?.resetNetworkState), `Zapret сброшен`)), children: `Сброс WinWS` })] })] }), (0, V.jsxs)(`div`, { className: `zapret-main`, children: [(0, V.jsxs)(Mp, { className: `zapret-status-panel`, children: [(0, V.jsx)(Np, { children: `Текущее состояние` }), (0, V.jsx)(Wp, { rows: [[`Активный конфиг`, he2 || `Профиль не выбран`], [`Статус`, ge2], [`Время работы`, _e2]] }), le2 && !ue2 && !T2 ? (0, V.jsxs)(`div`, { className: `zapret-best-banner`, "data-testid": `zapret-best-banner`, children: [(0, V.jsxs)(`div`, { children: [(0, V.jsx)(`strong`, { children: `Профиль: ${le2}` }), (0, V.jsx)(`small`, { children: `Результаты доступны в истории.` })] }), (0, V.jsx)(`button`, { className: `btn-primary`, "data-testid": `zapret-best-connect`, type: `button`, onClick: () => void n2(`zapret-standalone`, () => Z(`zapret.startStandalone`, window.egoistAPI?.zapret?.startStandalone, le2), `Zapret запущен`), children: `Подключить` })] }) : null] }), (0, V.jsxs)(Mp, { className: `zapret-workbench`, children: [(0, V.jsx)(`div`, { "aria-label": `Разделы профилей`, className: `tab-strip`, role: `tablist`, children: [[`history`, `История`], [`routes`, `Маршруты`]].map(([e3, t3]) => (0, V.jsx)(`button`, { "aria-selected": u2 === e3, className: u2 === e3 ? `active` : ``, role: `tab`, onClick: () => d2(e3), type: `button`, children: t3 }, e3)) }), u2 === `history` && (0, V.jsxs)(`div`, { className: `zapret-history-panel`, children: [(0, V.jsx)(Np, { children: `История тестов` }), r2.zapretAutoSelect ? (0, V.jsxs)(`div`, { className: `test-table`, children: [(0, V.jsxs)(`div`, { className: `table-head`, children: [(0, V.jsx)(`span`, { children: `Конфиг` }), (0, V.jsx)(`span`, { children: `Результат` }), (0, V.jsx)(`span`, { children: `Пинг` }), (0, V.jsx)(`span`, { children: `Успех` })] }), ve2.map((e3) => {
    let t3 = f2 === e3.name;
    return (0, V.jsxs)(`div`, { className: t3 ? `table-row zapret-history-row expanded` : `table-row zapret-history-row`, "aria-expanded": t3, "data-testid": `zapret-history-row`, onClick: () => p2((t4) => t4 === e3.name ? null : e3.name), onKeyDown: (t4) => {
      (t4.key === `Enter` || t4.key === ` `) && (t4.preventDefault(), p2((t5) => t5 === e3.name ? null : e3.name));
    }, role: `button`, tabIndex: 0, children: [(0, V.jsxs)(`div`, { className: `table-row-main`, children: [(0, V.jsx)(`span`, { children: e3.name }), (0, V.jsx)(`strong`, { className: e3.tone === `bad` ? `bad-text` : e3.tone === `good` ? `good-text` : `idle-text`, children: e3.result }), (0, V.jsx)(`span`, { children: e3.ping }), e3.tone === `bad` ? (0, V.jsx)(Id, { size: 14, className: `bad-text` }) : e3.tone === `good` ? (0, V.jsx)(ud, { size: 14, className: `good-text` }) : (0, V.jsx)(`span`, { className: `idle-text`, children: `—` })] }), t3 ? (0, V.jsx)(`div`, { className: `zapret-target-details`, "data-testid": `zapret-target-details`, "data-preview-note": e3.totalTargets > e3.targets.length ? `Показано целей: ${e3.targets.length} из ${e3.totalTargets}. Итог учитывает все проверки.` : void 0, children: e3.targets.length ? e3.targets.map((t4) => (0, V.jsxs)(`div`, { className: `zapret-target-detail`, children: [(0, V.jsx)(`span`, { children: t4.label }), (0, V.jsx)(`strong`, { children: t4.host }), (0, V.jsx)(`em`, { className: t4.ok ? `good-text` : `bad-text`, children: t4.ok ? `доступен` : `ошибка` }), (0, V.jsx)(`b`, { children: t4.ping })] }, `${e3.name}-${t4.label}-${t4.host}`)) : (0, V.jsx)(`div`, { className: `zapret-target-detail empty`, children: (0, V.jsx)(`span`, { children: `Детализация появится после автоподбора` }) }) }) : null] }, e3.name);
  })] }) : (0, V.jsxs)(`div`, { className: `empty-table-state compact-empty`, children: [(0, V.jsx)(bd, { size: 17 }), (0, V.jsx)(`span`, { children: `История появится после автоподбора` })] }), (0, V.jsxs)(`div`, { className: `table-foot`, children: [(0, V.jsx)(`span`, { children: r2.zapretAutoSelect?.testedAt ? `${r2.zapretAutoSelect.cancelled ? `Автоподбор остановлен.` : `Автоподбор завершён.`} ${Fm(r2.zapretAutoSelect.testedAt)}` : `Автоподбор ещё не запускался в этой сессии` }), (0, V.jsx)(Ed, { "aria-hidden": `true`, size: 14 })] })] }), u2 === `routes` && (0, V.jsxs)(`div`, { className: `zapret-routes-flowseal`, children: [(0, V.jsxs)(`div`, { className: `zapret-routes-grid compact-routes-grid`, children: [(0, V.jsx)(Vp, { label: `Добавить в обработку`, value: b2.generalDomains, onChange: (e3) => x2((t3) => ({ ...t3, generalDomains: e3 })) }), (0, V.jsx)(Vp, { label: `Добавить IP / CIDR в обработку`, value: b2.includedCidrs, onChange: (e3) => x2((t3) => ({ ...t3, includedCidrs: e3 })) }), (0, V.jsx)(Vp, { label: `Исключённые домены`, value: b2.excludedDomains, onChange: (e3) => x2((t3) => ({ ...t3, excludedDomains: e3 })) }), (0, V.jsx)(Vp, { label: `Исключённые IP / CIDR`, value: b2.excludedCidrs, onChange: (e3) => x2((t3) => ({ ...t3, excludedCidrs: e3 })) }), (0, V.jsx)(`button`, { className: `btn-primary full`, type: `button`, onClick: () => void n2(`zapret-save-lists`, () => Z(`zapret.saveUserLists`, window.egoistAPI?.zapret?.saveUserLists, Hm(b2)), `Пользовательские списки сохранены`), children: `Сохранить и применить` })] }), (0, V.jsxs)(`div`, { className: `zapret-grid-panel flowseal-panel route-flowseal-panel`, children: [(0, V.jsx)(Up, { label: `Игровой фильтр`, value: m2, options: [[`disabled`, `Выключен`], [`all`, `Все`], [`tcp`, `Только TCP`], [`udp`, `Только UDP`]], onChange: (e3) => void n2(`zapret-game-filter`, async () => (h2(e3), Z(`zapret.setGameFilterMode`, window.egoistAPI?.zapret?.setGameFilterMode, e3)), `Игровой фильтр обновлён`) }), (0, V.jsx)(Up, { label: `Набор IP`, value: g2, options: [[`none`, `Отключён`], [`any`, `Любой`], [`loaded`, `Загружен`]], onChange: (e3) => void n2(`zapret-ipset-mode`, async () => (_2(e3), Z(`zapret.setIpsetMode`, window.egoistAPI?.zapret?.setIpsetMode, e3)), `Режим IPSet обновлён`) }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void n2(`zapret-update-ipset`, () => Z(`zapret.updateIpsetList`, window.egoistAPI?.zapret?.updateIpsetList), `Список IPSet обновлён`), children: `Обновить IPSet` }), (0, V.jsx)(`button`, { className: `btn-primary full`, type: `button`, onClick: () => void n2(`zapret-update`, async () => {
    let e3 = await Z(`zapret.checkUpdates`, window.egoistAPI?.zapret?.checkUpdates);
    if (y2(e3), e3?.releaseVerified === false || !e3?.latestVersion) throw Error(Q(e3?.message) ?? `Не удалось получить сведения о релизе Flowseal.`);
    if (!e3?.updateAvailable) return { message: `Установлена актуальная версия Flowseal Core: ${Q(e3?.currentVersion) ?? `—`}` };
    let r3 = Q(e3?.latestVersion) ?? `latest`;
    return t2(`Обновить Flowseal Core до ${r3}`, `Текущая версия: ${Q(e3?.currentVersion) ?? `не прочитана`}.

EgoistShield скачает релиз Flowseal/zapret-discord-youtube с GitHub, проверит целостность архива по SHA-256, заменит runtime-файлы и сохранит ваши списки маршрутов и IPSet. Активный профиль будет перезапущен.`, `Обновить`, () => n2(`zapret-install-update`, () => Z(`zapret.installCoreUpdate`, window.egoistAPI?.zapret?.installCoreUpdate), `Flowseal Core обновлён до ${r3}`)), { message: `Доступно обновление ${r3}` };
  }, `Проверка обновлений Flowseal завершена`), children: `Обновить Flowseal Core` }), (0, V.jsxs)(`div`, { className: `flowseal-version-line`, children: [(0, V.jsxs)(`span`, { children: [`Текущая версия `, (0, V.jsx)(`strong`, { children: Q(r2.zapret?.coreVersion, r2.zapret?.version) ?? `не прочитана` })] }), (0, V.jsxs)(`span`, { children: [`Последняя версия `, (0, V.jsx)(`strong`, { children: Q(v2?.latestVersion, v2?.version) ?? `не проверялась` })] })] })] })] })] })] })] });
}
function Ep({ confirmAction: e2, runAction: t2, snapshot: n2 }) {
  let r2 = n2.telegram?.config ?? {}, i2 = O.useMemo(() => JSON.stringify([r2.host ?? null, r2.port ?? null, r2.secret ?? null, Array.isArray(r2.dcIp) ? r2.dcIp : [], r2.verbose ?? null, r2.bufKb ?? null, r2.poolSize ?? null, r2.logMaxMb ?? null, r2.checkUpdates ?? null]), [r2.host, r2.port, r2.secret, r2.dcIp, r2.verbose, r2.bufKb, r2.poolSize, r2.logMaxMb, r2.checkUpdates]), a2 = O.useCallback(() => ({ host: String(r2.host ?? Bf.host), port: String(r2.port ?? Bf.port), secret: String(r2.secret ?? Bf.secret), dcIp: Array.isArray(r2.dcIp) ? r2.dcIp.join(`
`) : ``, verbose: !!(r2.verbose ?? Bf.verbose), bufKb: String(r2.bufKb ?? Bf.bufKb), poolSize: String(r2.poolSize ?? Bf.poolSize), logMaxMb: String(r2.logMaxMb ?? Bf.logMaxMb), checkUpdates: !!(r2.checkUpdates ?? Bf.checkUpdates) }), [i2]), [o2, s2] = O.useState(a2), c2 = O.useRef(i2), [l2, u2] = O.useState(false), [d2, f2] = O.useState(false);
  O.useEffect(() => {
    if (i2 !== c2.current) {
      if (l2) {
        f2(true);
        return;
      }
      c2.current = i2, s2(a2());
    }
  }, [a2, i2, l2]);
  let p2 = O.useCallback((e3, t3) => {
    s2((n3) => ({ ...n3, [e3]: t3 })), u2(true);
  }, []), m2 = O.useCallback(() => {
    c2.current = i2, s2(a2()), u2(false), f2(false);
  }, [a2, i2]), h2 = O.useCallback(() => {
    c2.current = i2, f2(false);
  }, [i2]), { host: g2, port: _2, secret: v2, dcIp: y2, verbose: b2, bufKb: x2, poolSize: S2, logMaxMb: C2, checkUpdates: ee2 } = o2, te2 = (e3) => p2(`host`, e3), ne2 = (e3) => p2(`port`, e3), re2 = (e3) => p2(`secret`, e3), ie2 = (e3) => p2(`dcIp`, e3), ae2 = (e3) => p2(`verbose`, e3), oe2 = (e3) => p2(`bufKb`, e3), se2 = (e3) => p2(`poolSize`, e3), ce2 = (e3) => p2(`logMaxMb`, e3), w2 = (e3) => p2(`checkUpdates`, e3), T2 = () => Dm(r2, { host: g2, port: _2, secret: v2, dcIp: y2, verbose: b2, bufKb: x2, poolSize: S2, logMaxMb: C2, checkUpdates: ee2 }), le2 = async () => {
    let e3 = await Z(`telegramProxy.saveConfig`, window.egoistAPI?.telegramProxy?.saveConfig, T2());
    return u2(false), f2(false), e3;
  }, ue2 = async (e3) => (await le2(), e3()), de2 = !!(n2.telegram?.running || n2.telegram?.serviceRunning), E2 = !!(n2.telegram?.serviceInstalled || n2.telegram?.serviceRunning), fe2 = n2.telegram?.updateGate ?? n2.telegram?.health?.updateGate ?? {}, D2 = Q(n2.telegram?.currentVersion, fe2?.currentVersion) ?? `не определена`, pe2 = Q(fe2?.latestVersion, n2.telegram?.latestVersion, fe2?.targetVersion) ?? `не проверялась`, me2 = !!n2.telegram?.serviceRunning, he2 = n2.telegram?.health?.route, ge2 = he2?.state === `active`, _e2 = ge2 ? he2.mode === `cloudflare` ? `Cloudflare · ${he2.successfulFallbackConnections} сессий` : `${he2.mode} · ${he2.totalConnections} сессий` : de2 ? `ожидает трафик` : `не активен`, ve2 = de2 ? `работает` : `не запущен`, ye2 = E2 ? me2 ? `установлена, работает` : `установлена` : `не установлена`, be2 = am(Array.isArray(n2.telegram?.logTail) && n2.telegram.logTail.length > 0 ? n2.telegram.logTail : n2.runtimeLogs, `TG`).map($p), xe2 = async () => {
    let e3 = await Z(`telegramProxy.checkUpdates`, window.egoistAPI?.telegramProxy?.checkUpdates);
    return (e3?.updateAvailable === true || e3?.controlledInstallAllowed === true) && await Z(`telegramProxy.installUpdate`, window.egoistAPI?.telegramProxy?.installUpdate), e3;
  };
  return (0, V.jsxs)(`div`, { className: `telegram-layout`, children: [(0, V.jsxs)(Mp, { className: `telegram-form`, children: [(0, V.jsx)(Np, { children: `Управление Telegram` }), (0, V.jsx)(`p`, { className: `telegram-control-lead`, children: `Быстрый локальный прокси с автоматическим рабочим маршрутом.` }), (0, V.jsxs)(`details`, { className: `advanced-settings`, children: [(0, V.jsx)(`summary`, { children: `Расширенные настройки` }), (0, V.jsxs)(`div`, { className: `telegram-advanced-content`, children: [d2 ? (0, V.jsxs)(`div`, { className: `draft-conflict`, role: `status`, children: [(0, V.jsx)(`strong`, { children: `Конфигурация изменилась на стороне службы` }), (0, V.jsx)(`p`, { children: `Ваши несохранённые изменения не затёрты. Выберите, что оставить.` }), (0, V.jsxs)(`div`, { className: `draft-conflict-actions`, children: [(0, V.jsx)(`button`, { onClick: h2, type: `button`, children: `Оставить мои изменения` }), (0, V.jsx)(`button`, { onClick: m2, type: `button`, children: `Взять значения службы` })] })] }) : null, (0, V.jsxs)(`div`, { className: `telegram-address-grid`, children: [(0, V.jsx)(Bp, { label: `Локальный адрес`, value: g2, onChange: te2 }), (0, V.jsx)(Bp, { label: `Порт`, type: `number`, min: 1024, max: 65535, value: _2, onChange: ne2 })] }), (0, V.jsx)(Bp, { label: `Secret (32 hex-символа)`, type: `password`, value: v2, onChange: re2 }), (0, V.jsx)(Vp, { label: `Прямые Telegram DC (необязательно, по одному на строку)`, value: y2, onChange: ie2 }), (0, V.jsxs)(`div`, { className: `telegram-runtime-grid`, children: [(0, V.jsx)(Bp, { label: `Буфер, КБ`, type: `number`, min: 64, max: 4096, value: x2, onChange: oe2 }), (0, V.jsx)(Bp, { label: `Пул соединений`, type: `number`, min: 1, max: 32, value: S2, onChange: se2 }), (0, V.jsx)(Bp, { label: `Лимит лога, МБ`, type: `number`, min: 1, max: 100, value: C2, onChange: ce2 })] }), (0, V.jsxs)(`div`, { className: `telegram-advanced-toggles`, children: [(0, V.jsx)(Hp, { checked: b2, label: `Подробный журнал`, onToggle: () => ae2(!b2) }), (0, V.jsx)(Hp, { checked: ee2, label: `Проверять обновления runtime`, onToggle: () => w2(!ee2) })] }), (0, V.jsx)(`p`, { className: `telegram-advanced-note`, children: `Изменения сохраняются перед установкой службы, запуском или добавлением прокси в Telegram.` })] })] }), (0, V.jsxs)(`div`, { className: `telegram-primary-actions`, children: [(0, V.jsx)(`button`, { className: E2 ? `btn-secondary full service-ready` : `btn-secondary full`, type: `button`, onClick: () => void t2(`tg-install`, () => ue2(() => Z(`telegramProxy.installService`, window.egoistAPI?.telegramProxy?.installService)), `Фоновая служба Telegram установлена и запущена`), children: n2.busy === `tg-install` ? `Устанавливается…` : E2 ? `Переустановить службу` : `Установить фоновую службу` }), (0, V.jsx)(`button`, { className: de2 ? `btn-secondary full` : `btn-primary full`, disabled: !E2, title: E2 ? void 0 : `Сначала установите фоновую службу`, type: `button`, onClick: () => void t2(de2 ? `tg-stop` : `tg-start`, () => de2 ? Z(`telegramProxy.stop`, window.egoistAPI?.telegramProxy?.stop) : ue2(() => Z(`telegramProxy.start`, window.egoistAPI?.telegramProxy?.start)), de2 ? `Telegram Proxy остановлен` : `Telegram Proxy запущен`), children: n2.busy === `tg-start` ? `Запускается…` : n2.busy === `tg-stop` ? `Останавливается…` : de2 ? `Остановить` : `Запустить` }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void t2(`tg-open`, () => ue2(() => Z(`telegramProxy.openLink`, window.egoistAPI?.telegramProxy?.openLink)), `Telegram открыл ссылку прокси`), children: `Добавить в приложение` }), (0, V.jsx)(`button`, { className: `btn-danger full`, disabled: !E2, type: `button`, onClick: () => e2(`Удалить фоновую службу Telegram Proxy`, `Служба будет остановлена и снята с автозапуска. Локальный прокси перестанет работать после перезагрузки, пока вы не установите службу заново.

Настройки и журнал сохранятся.`, `Удалить`, () => t2(`tg-remove`, () => Z(`telegramProxy.removeService`, window.egoistAPI?.telegramProxy?.removeService), `Фоновая служба Telegram Proxy удалена`)), children: `Удалить` })] }), (0, V.jsxs)(`div`, { className: `telegram-update-card`, children: [(0, V.jsxs)(`div`, { className: `telegram-version-inline`, children: [(0, V.jsxs)(`span`, { children: [`Версия `, (0, V.jsx)(`strong`, { children: D2 })] }), (0, V.jsxs)(`span`, { children: [`Последняя `, (0, V.jsx)(`strong`, { children: pe2 })] })] }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void t2(`tg-update`, xe2, `Telegram проверен и обновлён при необходимости`), children: `Проверить обновление` })] })] }), (0, V.jsxs)(Mp, { className: `telegram-status`, children: [(0, V.jsx)(Np, { children: `Статус и логи` }), (0, V.jsx)(Fp, { tone: de2 ? `good` : `idle`, className: `corner-dot` }), (0, V.jsxs)(`div`, { className: `telegram-runtime-status`, children: [(0, V.jsxs)(`div`, { className: de2 ? `telegram-status-chip active` : `telegram-status-chip`, children: [(0, V.jsx)(Fp, { tone: de2 ? `good` : `idle` }), (0, V.jsx)(`span`, { children: `Прокси` }), (0, V.jsx)(`strong`, { children: ve2 })] }), (0, V.jsxs)(`div`, { className: E2 ? `telegram-status-chip active` : `telegram-status-chip`, children: [(0, V.jsx)(Fp, { tone: E2 ? `good` : `idle` }), (0, V.jsx)(`span`, { children: `Автозапуск` }), (0, V.jsx)(`strong`, { children: ye2 })] }), (0, V.jsxs)(`div`, { className: ge2 ? `telegram-status-chip active` : `telegram-status-chip`, children: [(0, V.jsx)(Fp, { tone: ge2 ? `good` : he2?.state === `error` ? `bad` : `idle` }), (0, V.jsx)(`span`, { children: `Маршрут` }), (0, V.jsx)(`strong`, { children: _e2 })] })] }), (0, V.jsxs)(`div`, { className: `log-head`, children: [(0, V.jsx)(Np, { children: `Журнал событий` }), (0, V.jsx)(`button`, { className: `btn-secondary compact`, type: `button`, onClick: () => void t2(`tg-logs`, () => Z(`telegramProxy.openLogs`, window.egoistAPI?.telegramProxy?.openLogs), `Папка логов открыта`), children: `Открыть` })] }), (0, V.jsx)(qp, { logs: be2 })] })] });
}
function Dp({ runAction: e2, snapshot: t2 }) {
  let n2 = t2.state?.settings ?? {}, [r2, i2] = O.useState({}), a2 = O.useRef(false);
  O.useEffect(() => i2({}), [t2.state]);
  let o2 = (e3, t3) => e3 in r2 ? r2[e3] : n2[e3] ?? t3, s2 = t2.isAdmin === true ? `Администратор` : t2.isAdmin === false ? `Обычный запуск` : `Проверяется`, c2 = t2.isAdmin === true ? `good` : t2.isAdmin === false ? `warn` : `idle`, l2 = Q(t2.diagnosticsExport?.filePath), u2 = Q(t2.update?.latestVersion), d2 = Q(t2.update?.phase) ?? `checking`, f2 = d2 === `available` && !!u2, p2 = [`checking`, `downloading`, `verifying`, `installing`, `restarting`].includes(d2), m2 = Number.isFinite(Number(t2.update?.progressPercent)) ? Math.max(0, Math.min(100, Number(t2.update.progressPercent))) : null, h2 = !!o2(`autoUpdate`, true), g2 = Q(t2.update?.message) ?? (f2 ? `Доступна доверенная версия ${u2}.` : d2 === `up-to-date` ? `Установлена последняя доступная версия.` : d2 === `blocked` ? `Обновление заблокировано проверкой доверия.` : d2 === `failed` ? `Не удалось подключиться к каналу обновлений.` : h2 ? `Проверяем подписанный stable-канал…` : `Автопроверка выключена: нажмите «Проверить».`), _2 = !!o2(`autoStart`, o2(`launchAtStartup`, false)), v2 = !!o2(`autoConnect`, o2(`autoConnectVpn`, false)), y2 = _2 || v2, b2 = async (n3, o3) => {
    if (a2.current) return false;
    a2.current = true;
    let s3 = r2, c3 = { ...r2, [n3]: o3 };
    i2(c3);
    try {
      let r3 = await e2(`setting-${n3}`, () => Z(`state.set`, window.egoistAPI?.state?.set, { ...t2.state ?? {}, settings: { ...t2.state?.settings ?? {}, ...c3 } }), `Настройка сохранена`);
      return r3 || i2(s3), r3;
    } finally {
      a2.current = false;
    }
  }, x2 = async () => {
    if (a2.current) return false;
    a2.current = true;
    let t3 = r2, n3 = !o2(`autoUpdate`, true);
    i2((e3) => ({ ...e3, autoUpdate: n3 }));
    try {
      let r3 = await e2(`update-auto`, () => Z(`updater.setAuto`, window.egoistAPI?.updater?.setAuto, n3), `Режим автообновлений изменён`);
      return r3 || i2(t3), r3;
    } finally {
      a2.current = false;
    }
  }, S2 = async () => Z(`updater.checkAndInstall`, window.egoistAPI?.updater?.checkAndInstall);
  return (0, V.jsxs)(`div`, { className: `settings-layout`, children: [(0, V.jsxs)(Mp, { className: `settings-surface settings-preferences-surface`, children: [(0, V.jsxs)(`header`, { className: `settings-surface-head`, children: [(0, V.jsx)(`h3`, { children: `Поведение` }), (0, V.jsx)(`p`, { children: `Запуск, соединение и приватность приложения.` })] }), (0, V.jsxs)(`div`, { className: `settings-section-list settings-preferences-list`, children: [(0, V.jsx)(Gp, { title: `Запуск и окно`, hint: `Поведение при входе в Windows и закрытии окна.`, items: [[v2 ? `Фоновый запуск при старте Windows` : `Запускать при старте Windows`, y2, () => b2(`autoStart`, !_2), v2, `Нужен для автоподключения маршрута после входа в Windows. DNS, Zapret и Telegram Proxy запускаются собственными службами независимо от приложения.`, `Стартует свёрнутым вместе с Windows.`], [`Сворачивать в трей`, !!o2(`minimizeToTray`, o2(`startMinimized`, false)), () => b2(`minimizeToTray`, !o2(`minimizeToTray`, o2(`startMinimized`, false))), false, void 0, `Крестик прячет окно в трей вместо выхода.`]] }), (0, V.jsx)(Gp, { title: `Поведение соединения`, hint: `Что приложение делает с маршрутом само.`, items: [[`Автоподключение маршрута`, !!o2(`autoConnect`, o2(`autoConnectVpn`, false)), () => b2(`autoConnect`, !o2(`autoConnect`, o2(`autoConnectVpn`, false))), false, void 0, `Восстанавливает последний сервер после входа.`], [`Переподключаться при обрыве`, !!o2(`reconnectOnDrop`, true), () => b2(`reconnectOnDrop`, !o2(`reconnectOnDrop`, true)), false, void 0, `Туннель поднимается заново после обрыва.`]] }), (0, V.jsx)(Gp, { title: `Уведомления`, hint: `Сообщения о смене состояния защиты.`, items: [[`Показывать уведомления`, !!o2(`notifications`, o2(`showNotifications`, true)), () => b2(`notifications`, !o2(`notifications`, o2(`showNotifications`, true))), false, void 0, `Сообщает только о важных изменениях состояния.`]] }), (0, V.jsx)(Gp, { title: `Приватность`, hint: `Данные, которые покидают ваш компьютер.`, items: [[`Передавать HWID провайдеру подписки`, !!o2(`sendSubscriptionHwid`, false), () => b2(`sendSubscriptionHwid`, !o2(`sendSubscriptionHwid`, false)), false, void 0, `Идентификатор устройства уходит с запросом подписки.`]] })] })] }), (0, V.jsxs)(Mp, { className: `settings-surface settings-service-surface`, children: [(0, V.jsxs)(`header`, { className: `settings-surface-head`, children: [(0, V.jsx)(`h3`, { children: `Обслуживание` }), (0, V.jsx)(`p`, { children: `Обновления, журналы и диагностика.` })] }), (0, V.jsxs)(`div`, { className: `settings-section-list settings-service-list`, children: [(0, V.jsxs)(Gp, { className: `settings-release-panel`, title: `Версия и обновление`, hint: `Фоновая проверка и ручное применение доверенных релизов.`, items: [[`Автоматически проверять обновления`, !!o2(`autoUpdate`, true), () => void x2(), false, void 0, `Проверяет релиз в фоне; устанавливаются только доверенные сборки.`]], children: [(0, V.jsxs)(`div`, { className: `settings-update-status`, children: [(0, V.jsx)(Fp, { tone: f2 || d2 === `up-to-date` ? `good` : [`blocked`, `failed`].includes(d2) ? `bad` : p2 ? `info` : `idle` }), (0, V.jsx)(`span`, { children: g2 })] }), p2 && m2 !== null ? (0, V.jsxs)(`div`, { className: `settings-update-progress`, role: `progressbar`, "aria-label": `Ход обновления Egoist Lagom`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(m2), children: [(0, V.jsx)(`span`, { style: { inlineSize: `${m2}%` } }), (0, V.jsxs)(`b`, { children: [Math.round(m2), `%`] })] }) : null, (0, V.jsxs)(`div`, { className: `settings-release-actions`, children: [[`blocked`, `failed`].includes(d2) ? (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void e2(`release-page`, () => Z(`updater.openReleasePage`, window.egoistAPI?.updater?.openReleasePage), `Страница релиза открыта`), children: `Открыть релиз` }) : null, (0, V.jsx)(`button`, { className: `btn-primary full`, type: `button`, disabled: p2, "aria-busy": p2, onClick: () => void e2(`update-check`, S2, `Канал обновлений проверен`), children: d2 === `downloading` && m2 !== null ? `Загрузка ${Math.round(m2)}%` : d2 === `verifying` ? `Проверка файла…` : d2 === `installing` ? `Запуск установки…` : d2 === `restarting` ? `Перезапуск…` : d2 === `checking` ? `Проверяем…` : f2 ? `Установить ${u2}` : `Проверить` })] })] }), (0, V.jsx)(Gp, { className: `settings-log-panel`, title: `Логи`, hint: `Хранятся локально 7 дней, секреты скрываются автоматически.`, children: (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void e2(`open-log-folder`, () => Z(`logs.openFolder`, window.egoistAPI?.logs?.openFolder), `Папка логов открыта`), children: `Открыть папку с логами` }) }), (0, V.jsxs)(Gp, { className: `settings-maintenance-panel`, title: `Доступ и диагностика`, hint: `Системными компонентами управляет служба Lagom. Для TUN пока требуется запуск приложения от имени администратора.`, children: [(0, V.jsxs)(`div`, { className: `settings-status-row`, children: [(0, V.jsxs)(`span`, { children: [(0, V.jsx)(Fp, { tone: c2 }), `Права приложения`] }), (0, V.jsx)(`strong`, { children: s2 })] }), (0, V.jsx)(`button`, { className: `btn-secondary full`, type: `button`, onClick: () => void e2(`diagnostics-export`, () => Z(`diagnostics.exportBundle`, window.egoistAPI?.diagnostics?.exportBundle), `Диагностический архив создан`), children: `Экспортировать диагностику` }), l2 ? (0, V.jsxs)(`p`, { className: `settings-path`, children: [`Архив: `, l2] }) : (0, V.jsx)(`p`, { className: `settings-panel-hint compact`, children: `Состояние служб и последние логи в одном архиве.` })] })] })] }), (0, V.jsx)(Op, {})] });
}
function Op() {
  let [e2, t2] = O.useState(Qf);
  return O.useEffect(() => {
    let e3 = false;
    return (async () => {
      let n2 = await window.egoistAPI?.app?.getVersion?.().catch(() => null);
      !e3 && n2?.version && t2(n2.version);
    })(), () => {
      e3 = true;
    };
  }, []), (0, V.jsxs)(`span`, { className: `app-version`, children: [`Версия приложения `, e2] });
}
function kp(e2, t2 = 480) {
  let n2 = nd(), [r2, i2] = O.useState(e2), a2 = O.useRef(e2), o2 = O.useRef(null);
  return O.useEffect(() => {
    let r3 = a2.current;
    if (e2 == null || r3 == null || n2 || Math.abs(e2 - r3) < 1e-6) {
      a2.current = e2, i2(e2);
      return;
    }
    let s2 = performance.now(), c2 = e2 - r3, l2 = r3, u2 = (n3) => {
      let r4 = Math.min(1, (n3 - s2) / t2), d2 = 1 - (1 - r4) ** 4, f2 = r4 >= 1 ? e2 : l2 + c2 * d2;
      a2.current = f2, i2(f2), o2.current = r4 >= 1 ? null : window.requestAnimationFrame(u2);
    };
    return o2.current = window.requestAnimationFrame(u2), () => {
      o2.current != null && window.cancelAnimationFrame(o2.current), o2.current = null;
    };
  }, [t2, n2, e2]), r2;
}
function Ap({ format: e2, placeholder: t2 = `—`, value: n2 }) {
  let r2 = kp(n2);
  return (0, V.jsx)(`span`, { className: `animated-number`, children: r2 == null ? t2 : e2(r2) });
}
function jp({ busy: e2, connected: t2, onClick: n2 }) {
  return (0, V.jsxs)(td.button, { "aria-busy": e2, "aria-label": t2 ? `Отключить` : `Подключить`, "aria-pressed": t2, className: `${t2 ? `power-button active` : `power-button`}${e2 ? ` busy` : ``}`, disabled: e2, onClick: n2, type: `button`, whileHover: e2 ? void 0 : { scale: 1.015, transition: { type: `spring`, stiffness: 320, damping: 24 } }, whileTap: { scale: 0.965, transition: { duration: 0.12 } }, children: [(0, V.jsx)(`span`, { className: `power-breath`, "aria-hidden": `true` }), (0, V.jsx)(`span`, { className: `power-status-ring`, "aria-hidden": `true` }), (0, V.jsx)(`span`, { className: `power-progress-ring`, "aria-hidden": `true` }), (0, V.jsx)(`span`, { className: `power-core`, children: (0, V.jsx)(wd, { size: 38, strokeWidth: 2.5 }) })] });
}
function Mp({ children: e2, className: t2 = `` }) {
  return (0, V.jsx)(td.article, { className: `panel ${t2}`, variants: Df, children: e2 });
}
function Np({ children: e2 }) {
  return (0, V.jsx)(`h3`, { className: `section-title`, children: e2 });
}
function Pp({ label: e2, tone: t2, value: n2 }) {
  return (0, V.jsxs)(`div`, { className: `status-line`, children: [(0, V.jsx)(Fp, { tone: t2 }), (0, V.jsx)(`span`, { children: e2 }), (0, V.jsx)(`strong`, { children: n2 })] });
}
function Fp({ className: e2 = ``, tone: t2 }) {
  return (0, V.jsx)(`i`, { "aria-hidden": `true`, className: `dot ${t2} ${e2}` });
}
function Ip(e2) {
  return e2 === `good` ? `Проверка пройдена` : e2 === `bad` ? `Проверка не пройдена` : `Профиль ещё не проверен`;
}
function Lp({ countryCode: e2 }) {
  let t2 = vm(e2), n2 = Sf.get(t2);
  return n2 ? (0, V.jsx)(`img`, { alt: ``, "aria-label": t2.toUpperCase(), className: `country-flag country-flag-img`, decoding: `async`, draggable: false, src: n2 }) : (0, V.jsx)(`i`, { "aria-label": t2.toUpperCase(), className: `country-flag country-flag-missing`, children: t2 === `xx` ? `?` : t2.toUpperCase() });
}
function Rp({ active: e2, series: t2 }) {
  let n2 = e2 ? Am(t2.length ? t2 : Af) : [];
  return (0, V.jsx)(`div`, { "aria-hidden": `true`, className: e2 ? `traffic-bars active` : `traffic-bars empty`, children: (n2.length ? n2 : Af.map(() => 0)).map((e3, t3) => (0, V.jsx)(`i`, { style: { height: `${e3}%` } }, t3)) });
}
function zp({ busy: e2 = false, icon: t2, onClick: n2, progress: r2 = null, result: i2 = false, text: a2, title: o2 }) {
  return (0, V.jsxs)(td.button, { "aria-busy": e2, className: `action-tile${e2 ? ` busy` : ``}${i2 ? ` result` : ``}`, disabled: e2, onClick: n2, type: `button`, variants: Df, whileTap: { scale: 0.985 }, children: [(0, V.jsx)(`span`, { children: (0, V.jsx)(t2, { size: 22 }) }), (0, V.jsx)(`strong`, { children: o2 }), (0, V.jsx)(`em`, { children: a2 }), r2 == null ? null : (0, V.jsx)(`i`, { className: `action-progress`, "aria-hidden": `true`, children: (0, V.jsx)(`b`, { style: { width: `${r2}%` } }) })] });
}
function Bp({ label: e2, max: t2, min: n2, onChange: r2, readOnly: i2 = false, type: a2 = `text`, value: o2 }) {
  return (0, V.jsxs)(`label`, { className: `field-label`, children: [(0, V.jsx)(`span`, { children: e2 }), (0, V.jsx)(`input`, { className: `input`, max: t2, min: n2, readOnly: i2, type: a2, value: o2, onChange: (e3) => r2(e3.target.value) })] });
}
function Vp({ label: e2, onChange: t2, value: n2 }) {
  return (0, V.jsxs)(`label`, { className: `field-label`, children: [(0, V.jsx)(`span`, { children: e2 }), (0, V.jsx)(`textarea`, { className: `input input-area`, readOnly: !t2, value: n2, onChange: (e3) => t2?.(e3.target.value) })] });
}
function Hp({ checked: e2, label: t2, onToggle: n2 }) {
  return (0, V.jsxs)(`button`, { "aria-checked": e2, className: e2 ? `toggle-line compact-toggle on` : `toggle-line compact-toggle`, role: `switch`, type: `button`, onClick: n2, children: [(0, V.jsx)(`span`, { children: t2 }), (0, V.jsx)(`i`, { "aria-hidden": `true` })] });
}
function Up({ label: e2, onChange: t2, options: n2, value: r2 }) {
  return (0, V.jsxs)(`label`, { className: `field-label`, children: [(0, V.jsx)(`span`, { children: e2 }), (0, V.jsx)(`select`, { className: `input`, value: r2, onChange: (e3) => t2(e3.target.value), children: n2.map(([e3, t3]) => (0, V.jsx)(`option`, { value: e3, children: t3 }, e3)) })] });
}
function Wp({ rows: e2 }) {
  return (0, V.jsx)(`div`, { className: `kv-list`, children: e2.map(([e3, t2]) => (0, V.jsxs)(`div`, { children: [(0, V.jsx)(`span`, { children: e3 }), (0, V.jsx)(`strong`, { className: t2 === `Активен` || t2 === `Включено` || t2 === `Работает` ? `good-text` : ``, children: t2 })] }, e3)) });
}
function Gp({ children: e2, className: t2 = ``, hint: n2, items: r2 = [], title: i2 }) {
  return (0, V.jsxs)(`section`, { className: `settings-section ${t2}`.trim(), children: [(0, V.jsxs)(`div`, { className: `settings-section-head`, children: [(0, V.jsx)(`h4`, { children: i2 }), n2 ? (0, V.jsx)(`p`, { children: n2 }) : null] }), r2.length ? (0, V.jsx)(`div`, { className: `settings-section-items`, children: r2.map(([e3, t3, n3, r3, i3, a2]) => (0, V.jsx)(Kp, { checked: t3, description: a2, disabled: r3, disabledReason: i3, label: e3, onToggle: n3 }, e3)) }) : null, e2] });
}
function Kp({ checked: e2, description: t2, disabled: n2 = false, disabledReason: r2, label: i2, onToggle: a2 }) {
  const tooltipRef = O.useRef(null);
  let o2 = n2 && r2 ? r2 : t2, [s2, c2] = O.useState(null), l2 = O.useRef(null), u2 = s2 !== null, d2 = `toggle-hint-${O.useId()}`, f2 = O.useCallback(() => {
    let e3 = l2.current?.getBoundingClientRect();
    e3 && c2({ top: Math.round(e3.bottom + 6), right: Math.round(window.innerWidth - e3.right) });
  }, []), p2 = O.useCallback(() => c2(null), []), m2 = O.useCallback((e3) => {
    (typeof e3 == `function` ? e3(s2 !== null) : e3) ? f2() : p2();
  }, [s2, p2, f2]);
  O.useLayoutEffect(() => {
    if (!u2 || !tooltipRef.current) return;
    const position = () => {
      const anchor = l2.current?.getBoundingClientRect(), tip = tooltipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const below = anchor.bottom + 6;
      const top = below + tip.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - tip.height - 6);
      const right = Math.max(8, Math.min(window.innerWidth - anchor.right, window.innerWidth - tip.width - 8));
      c2(current => current && (current.top !== top || current.right !== right) ? { top, right } : current);
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [u2, o2]);
  return (0, V.jsxs)(`div`, { className: `toggle-setting-row${n2 ? ` is-disabled` : ``}`, children: [(0, V.jsxs)(`button`, { "aria-checked": e2, "aria-describedby": o2 ? d2 : void 0, "aria-disabled": n2 || void 0, className: `toggle-setting${t2 ? ` has-description` : ``}${n2 ? ` is-disabled` : ``}`, onClick: n2 ? void 0 : a2, role: `switch`, type: `button`, children: [(0, V.jsx)(`span`, { className: `toggle-setting-text`, children: (0, V.jsx)(`span`, { children: i2 }) }), (0, V.jsx)(`i`, { "aria-hidden": `true`, className: e2 ? `on` : `` })] }), o2 ? (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(`button`, { "aria-controls": d2, "aria-expanded": u2, "aria-label": `Пояснение: ${i2}`, className: `toggle-setting-help`, onBlur: () => m2(false), onClick: () => m2((e3) => !e3), onFocus: () => m2(true), onMouseEnter: () => m2(true), onMouseLeave: () => m2(false), ref: l2, type: `button`, children: (0, V.jsx)(dd, { "aria-hidden": `true`, size: 13, strokeWidth: bf }) }), (0, V.jsx)(`span`, { className: `sr-only`, id: d2, role: `tooltip`, children: o2 }), s2 ? (0, V.jsx)(`span`, { "aria-hidden": `true`, ref: tooltipRef, className: `toggle-setting-hint visible`, style: { top: `${s2.top}px`, right: `${s2.right}px` }, children: o2 }) : null] }) : null] });
}
function qp({ compact: e2, logs: t2 }) {
  let n2 = O.useMemo(() => {
    let n3 = t2.map((e3, t3) => ({ line: e3, index: t3, at: Jp(e3) }));
    return n3.sort((e3, t3) => e3.at === t3.at ? e3.index - t3.index : e3.at - t3.at), n3.slice(-(e2 ? 9 : 26)).reverse().map((e3) => e3.line);
  }, [t2, e2]);
  return n2.length === 0 ? (0, V.jsx)(`div`, { className: e2 ? `log-list compact` : `log-list`, children: (0, V.jsxs)(`div`, { className: `log-empty`, children: [(0, V.jsx)(Y, { size: 16 }), (0, V.jsx)(`span`, { children: `Логи пока не получены` })] }) }) : (0, V.jsx)(`div`, { className: e2 ? `log-list compact` : `log-list`, children: n2.map((e3, t3) => (0, V.jsxs)(`div`, { className: `log-line ${Xp(e3)}`, children: [(0, V.jsx)(`span`, { children: Yp(e3) }), (0, V.jsx)(`strong`, { children: Zp(e3) }), (0, V.jsx)(`p`, { children: Qp(e3) })] }, `${e3.timestamp ?? t3}-${t3}`)) });
}
function Jp(e2) {
  let t2 = Q(e2?.timestamp, e2?.time, e2?.date) ?? ``, n2 = t2 ? Date.parse(t2) : NaN;
  return Number.isFinite(n2) ? n2 : 2 ** 53 - 1;
}
function Yp(e2) {
  let t2 = Q(e2?.timestamp, e2?.time, e2?.date) ?? ``;
  if (!t2) return ``;
  let n2 = Date.parse(t2);
  if (!Number.isFinite(n2)) return t2.length > 12 ? t2.slice(0, 12) : t2;
  let r2 = new Date(n2), i2 = r2.toLocaleTimeString(`ru-RU`, { hour: `2-digit`, minute: `2-digit`, second: `2-digit` }), a2 = /* @__PURE__ */ new Date();
  return r2.getFullYear() === a2.getFullYear() && r2.getMonth() === a2.getMonth() && r2.getDate() === a2.getDate() ? i2 : `${r2.toLocaleDateString(`ru-RU`, { day: `2-digit`, month: `2-digit` })} ${i2}`;
}
function Xp(e2) {
  let t2 = Zp(e2);
  return /^(ERR|ERROR|FATAL|CRIT)/.test(t2) ? `bad` : /^(WARN|WRN)/.test(t2) ? `warn` : ``;
}
function Zp(e2) {
  return (Q(e2?.level, e2?.component) ?? `INFO`).toUpperCase().slice(0, 7);
}
function Qp(e2) {
  return Q(e2?.message, e2?.summary, e2?.text) ?? JSON.stringify(e2);
}
function $p(e2) {
  let t2 = Qp(e2).replace(/secret=dd[a-f0-9]{32,}/gi, `secret=dd••••`).replace(/\b[a-f0-9]{32}\b/gi, `••••`).replace(/\s+/g, ` `).trim();
  return { ...e2, message: em(t2).replace(/^Config:\s*/i, `config: `).replace(/^=+$/, ``).replace(/Telegram MTProto WS Bridge Proxy/i, `MTProto WS Bridge`) };
}
function em(e2) {
  let t2 = /stats:\s*(?<body>.+?)(?:\s*\|\s*ws_bl:\s*(?<blacklist>.+))?$/i.exec(e2);
  if (t2?.groups?.body) {
    let e3 = t2.groups.body, n3 = /\bactive=(\d+)/i.exec(e3)?.[1], r3 = /\bws=(\d+)/i.exec(e3)?.[1], i3 = /\bpool=([^\s]+)/i.exec(e3)?.[1], a3 = /\bup=([^\s]+)/i.exec(e3)?.[1], o2 = /\bdown=([^\s]+)/i.exec(e3)?.[1], s2 = /\berr=(\d+)/i.exec(e3)?.[1];
    return [`stats:`, n3 ? `active=${n3}` : null, r3 ? `ws=${r3}` : null, i3 ? `pool=${i3}` : null, o2 ? `↓${o2}` : null, a3 ? `↑${a3}` : null, s2 ? `err=${s2}` : null].filter(Boolean).join(` `);
  }
  let n2 = /^\[[^\]]+\]\s*(DC\d+m?)\s+WS session closed:\s*\^([^\s]+).*?\sv([^\s]+).*?\sin\s([^\s]+)/i.exec(e2);
  if (n2) return `${n2[1]} WS closed: ↑${n2[2]} ↓${n2[3]} ${n2[4]}`;
  let r2 = /^\[[^\]]+\]\s*(DC\d+)(\s+media)?\s*->\s*(?:wss:\/\/)?([^/\s]+).*?\svia\s+([^\s]+)/i.exec(e2);
  if (r2) return `${r2[1]}${r2[2] ? ` media` : ``} -> ${r2[3]} via ${r2[4]}`;
  let i2 = /^\[[^\]]+\]\s*(DC\d+)(\s+media)?\s*->\s*pool hit via\s+([^\s]+)/i.exec(e2);
  if (i2) return `${i2[1]}${i2[2] ? ` media` : ``} -> pool hit via ${i2[3]}`;
  let a2 = /^\[[^\]]+\]\s*(DC\d+)(\s+media)?\s+WS connect failed:\s*(.+)$/i.exec(e2);
  return a2 ? `${a2[1]}${a2[2] ? ` media` : ``} WS failed: ${a2[3]}` : e2;
}
function tm(e2) {
  let t2 = e2.indexOf(`:`);
  if (t2 <= 0 || t2 >= e2.length - 1) return false;
  let n2 = e2.slice(0, t2), r2 = e2.slice(t2 + 1).trim();
  return n2.length <= 28 && !/[.!?,;]/.test(n2) && r2.length > 0 && r2.length <= 48;
}
function nm(e2) {
  let t2 = [];
  for (let n2 of e2.split(/\n{2,}/)) {
    let e3 = n2.split(`
`).map((e4) => e4.trim()).filter(Boolean);
    if (e3.length === 0) continue;
    let r2 = e3.filter((e4) => /^[•\-–]\s+/.test(e4));
    if (r2.length > 0) {
      let n3 = e3.filter((e4) => !/^[•\-–]\s+/.test(e4));
      t2.push({ kind: `list`, title: n3.length > 0 ? n3.join(` `) : null, items: r2.map((e4) => e4.replace(/^[•\-–]\s+/, ``)) });
      continue;
    }
    if (e3.length >= 2 && e3.every(tm)) {
      t2.push({ kind: `meta`, rows: e3.map((e4) => {
        let t3 = e4.indexOf(`:`);
        return [`${e4.slice(0, t3)}:`, e4.slice(t3 + 1).trim()];
      }) });
      continue;
    }
    t2.push({ kind: `paragraph`, text: e3.join(` `) });
  }
  return t2.length > 0 ? t2 : [{ kind: `paragraph`, text: e2 }];
}
function rm({ onClose: e2, state: t2 }) {
  let n2 = O.useRef(null), r2 = O.useRef(null), i2 = O.useId(), a2 = O.useId(), o2 = O.useMemo(() => nm(t2?.body ?? ``), [t2?.body]);
  return O.useEffect(() => {
    if (!t2) return;
    let i3 = document.activeElement instanceof HTMLElement ? document.activeElement : null, a3 = (t3) => {
      if (t3.key === `Escape`) {
        t3.preventDefault(), e2();
        return;
      }
      if (t3.key !== `Tab` || !n2.current) return;
      let r3 = Array.from(n2.current.querySelectorAll(`button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])`));
      if (r3.length === 0) {
        t3.preventDefault(), n2.current.focus();
        return;
      }
      let i4 = r3[0], a4 = r3[r3.length - 1];
      t3.shiftKey && document.activeElement === i4 ? (t3.preventDefault(), a4.focus()) : !t3.shiftKey && document.activeElement === a4 && (t3.preventDefault(), i4.focus());
    };
    document.addEventListener(`keydown`, a3);
    const focusFrame = window.requestAnimationFrame(() => r2.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(`keydown`, a3);
      i3?.isConnected && i3.focus({ preventScroll: true });
    };
  }, [e2, t2]), (0, V.jsx)(ul, { children: t2 ? (0, V.jsx)(td.div, { animate: { opacity: 1, transition: { duration: 0.18, ease: wf } }, className: `modal-layer`, exit: { opacity: 0, transition: kf }, initial: { opacity: 0 }, children: (0, V.jsxs)(td.div, { "aria-describedby": a2, "aria-labelledby": i2, "aria-modal": `true`, animate: { opacity: 1, y: 0, scale: 1, transition: Of }, className: t2.tone === `info` ? `modal modal-info` : `modal modal-warning`, exit: { opacity: 0, y: 8, scale: 0.975, transition: kf }, initial: { opacity: 0, y: 14, scale: 0.94 }, ref: n2, role: `dialog`, tabIndex: -1, children: [(0, V.jsx)(`span`, { "aria-hidden": `true`, className: `modal-sheen` }), (0, V.jsx)(`button`, { "aria-label": `Закрыть диалог`, className: `modal-close`, onClick: e2, ref: r2, type: `button`, children: (0, V.jsx)(Id, { size: 16 }) }), (0, V.jsxs)(`header`, { className: `modal-head`, children: [(0, V.jsx)(`span`, { "aria-hidden": `true`, className: `modal-icon`, children: t2.tone === `info` ? (0, V.jsx)(dd, { size: 23, strokeWidth: 1.9 }) : (0, V.jsx)(Nd, { size: 23, strokeWidth: 1.9 }) }), (0, V.jsxs)(`div`, { className: `modal-heading`, children: [(0, V.jsx)(`span`, { className: `modal-kicker`, children: t2.tone === `info` ? `Информация` : `Подтверждение действия` }), (0, V.jsx)(`h3`, { id: i2, children: t2.title })] })] }), (0, V.jsx)(`div`, { className: `modal-body`, id: a2, children: o2.map((e3, t3) => e3.kind === `meta` ? (0, V.jsx)(`div`, { className: `modal-meta`, children: e3.rows.map(([e4, t4]) => (0, V.jsxs)(`div`, { className: `modal-meta-row`, children: [(0, V.jsx)(`span`, { children: e4 }), (0, V.jsx)(`strong`, { children: t4 })] }, e4)) }, `meta-${t3}`) : e3.kind === `list` ? (0, V.jsxs)(`div`, { className: `modal-list`, children: [e3.title ? (0, V.jsx)(`p`, { className: `modal-list-title`, children: e3.title }) : null, (0, V.jsx)(`ul`, { children: e3.items.map((e4) => (0, V.jsx)(`li`, { children: e4 }, e4)) })] }, `list-${t3}`) : (0, V.jsx)(`p`, { children: e3.text }, `text-${t3}`)) }), (0, V.jsx)(`div`, { className: `modal-actions`, children: t2.onConfirm && t2.actionLabel ? (0, V.jsxs)(V.Fragment, { children: [(0, V.jsx)(`button`, { className: `btn-secondary`, onClick: e2, type: `button`, children: `Отмена` }), (0, V.jsx)(`button`, { className: `btn-primary`, onClick: () => {
    e2(), t2.onConfirm?.();
  }, type: `button`, children: t2.actionLabel })] }) : (0, V.jsx)(`button`, { className: `btn-primary`, onClick: e2, type: `button`, children: `Закрыть` }) })] }) }) : null });
}
function im(e2) {
  return e2?.status === `fulfilled` ? e2.value ?? null : null;
}
function am(e2, t2) {
  return Array.isArray(e2) ? e2.map((e3) => {
    if (typeof e3 == `string`) {
      let n2 = /^(?<time>(?:\d{4}-\d{2}-\d{2}[ T])?\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\s*(?:\[(?<level>[A-Z]+)\]|(?<plainLevel>INFO|WARN|ERROR|DEBUG)\b[: ]*)?\s*(?<message>.*)$/i.exec(e3.trim());
      return { time: n2?.groups?.time ?? ``, level: n2?.groups?.level ?? n2?.groups?.plainLevel ?? t2, message: n2?.groups?.message?.trim() || e3 };
    }
    return e3 && typeof e3 == `object` ? e3 : { time: ``, level: t2, message: String(e3) };
  }).filter((e3) => String(e3.message ?? e3.summary ?? e3.text ?? ``).trim().length > 0) : [];
}
function Z(e2, t2, ...n2) {
  return t2 ? t2(...n2) : Promise.reject(Error(`IPC method is unavailable: ${e2}`));
}
function om(e2) {
  let t2 = e2;
  return typeof t2.lastError == `string` && t2.lastError.trim().length > 0 || typeof t2.error == `string` && t2.error.trim().length > 0 || t2.lifecycle === `failed`;
}
function sm(e2, t2 = `Backend reported that the action failed.`) {
  let n2 = e2;
  return typeof n2.lastError == `string` && n2.lastError.trim() ? n2.lastError : typeof n2.error == `string` && n2.error.trim() ? n2.error : typeof n2.message == `string` && n2.message.trim() ? n2.message : typeof n2.failureReason == `string` && n2.failureReason.trim() ? n2.failureReason : typeof n2.details == `string` && n2.details.trim() ? n2.details : n2.status && typeof n2.status.lastError == `string` && n2.status.lastError.trim() ? n2.status.lastError : n2.status && typeof n2.status.error == `string` && n2.status.error.trim() ? n2.status.error : n2.status && typeof n2.status.message == `string` && n2.status.message.trim() ? n2.status.message : t2;
}
function cm(e2, t2) {
  let n2 = um(e2), r2 = n2.toLowerCase();
  if (t2 === `update-check`) {
    let e3 = /заблок|подпис|signature|integrity|manifest|release key|anti-rollback/i.test(n2);
    return lm(e3 ? `UPDATE-BLOCKED` : `UPDATE-CHECK`, e3 ? `Обновление заблокировано` : `Не удалось проверить обновление`, n2 || `Повторите попытку позже или откройте журнал.`);
  }
  if (t2.startsWith(`dns`) || t2.includes(`doh`) || t2.includes(`gravityless`)) {
    let e3 = qd(n2);
    return e3 === `core` ? lm(`DNS-CORE`, `Служба DNS не готова`, `Системная служба Egoist Lagom не ответила. Подождите несколько секунд и повторите; если ошибка останется — переустановите текущую версию.`) : e3 === `admin` ? lm(`DNS-ADMIN`, `Ошибка DNS`, `Нужны права администратора для изменения DNS Windows.`) : e3 === `no-interface` ? lm(`DNS-NO-IFACE`, `Ошибка DNS`, `Активный сетевой адаптер Windows не найден.`) : e3 === `verify` ? lm(`DNS-VERIFY`, `Ошибка DNS`, `Windows не подтвердила применение новых DNS.`) : lm(`DNS-APPLY`, `Ошибка DNS`, `DNS не применён. Проверьте права администратора и активный адаптер.`);
  }
  return t2.startsWith(`zapret`) ? /getaddrinfo|enotfound|econnrefused|econnreset|network|сет[ьи] недоступ|fetch failed|http 5\d\d/i.test(n2) ? lm(`ZAPRET-NETWORK`, `Ошибка Zapret`, `GitHub недоступен: проверьте интернет и повторите. Локальный Core продолжает работать.`) : /http 403|rate limit|превышен лимит/i.test(n2) ? lm(`ZAPRET-RATE-LIMIT`, `Ошибка Zapret`, `GitHub временно ограничил запросы. Повторите через несколько минут.`) : /conflict|конфликт|goodbyedpi|external-zapret|zapret_discord/i.test(n2) ? lm(`ZAPRET-CONFLICT`, `Ошибка Zapret`, `Найден конфликтующий сетевой компонент или старая служба.`) : /windivert|driver|драйвер/i.test(n2) ? lm(`ZAPRET-DRIVER`, `Ошибка Zapret`, `Драйвер WinDivert не готов или занят другим процессом.`) : /timeout|timed out|таймаут|не ответил вовремя/i.test(n2) ? lm(`ZAPRET-TIMEOUT`, `Ошибка Zapret`, `Профиль не ответил за отведённое время.`) : /not found|не найден|missing/i.test(n2) ? lm(`ZAPRET-RUNTIME`, `Ошибка Zapret`, `Не найден runtime-файл Zapret.`) : lm(`ZAPRET-ACTION`, `Ошибка Zapret`, n2 || `Действие Zapret не выполнено. Подробности сохранены в логах.`) : r2.includes(`command failed`) || r2.includes(`powershell`) || r2.includes(`cmd.exe`) ? lm(`SYSTEM-COMMAND`, `Системная ошибка`, `Системная команда завершилась с ошибкой. Подробности сохранены в логах.`) : lm(`APP-ACTION`, `Действие не выполнено`, n2 || `Операция завершилась ошибкой.`);
}
function lm(e2, t2, n2) {
  try {
    console.warn(`[activity] ${e2}: ${n2}`);
  } catch {
  }
  return { title: t2, detail: n2, code: e2 };
}
function um(e2) {
  let t2 = e2 instanceof Error ? e2.message : String(e2 ?? ``), n2 = (t2.replace(/Command failed:[\s\S]*/i, ``).replace(/At line:\d+[\s\S]*/i, ``).replace(/\+ CategoryInfo[\s\S]*/i, ``).replace(/\+ FullyQualifiedErrorId[\s\S]*/i, ``) || t2).replace(/\s+/g, ` `).trim();
  return n2.length > 180 ? `${n2.slice(0, 177)}...` : n2;
}
function dm(e2, t2) {
  let n2 = e2?.activeNodeId ?? t2?.activeNodeId, r2 = Array.isArray(t2?.nodes) ? t2.nodes.find((e3) => e3.id === n2) : null;
  return Kd(e2?.activeNode?.name ?? e2?.nodeName ?? r2?.name ?? r2?.remark ?? n2 ?? `Узел не выбран`);
}
function fm(e2, t2) {
  let n2 = e2?.activeNodeId ?? t2?.activeNodeId, r2 = Array.isArray(t2?.nodes) ? t2.nodes.find((e3) => e3.id === n2) : null, i2 = Q(r2?.subscriptionId, r2?.metadata?.subscriptionId, e2?.subscriptionId), a2 = Array.isArray(t2?.subscriptions) ? t2.subscriptions : [], o2 = a2.find((e3) => Q(e3?.id) === i2) ?? a2[0] ?? null, s2 = Q(r2?.metadata?.provider, r2?.metadata?.subscriptionName, o2?.name, o2?.provider, bm(o2?.url), e2?.provider);
  return s2 ? Kd(s2) : null;
}
function pm(e2) {
  return Array.isArray(e2) ? e2.map((e3, t2) => {
    let n2 = Q(e3?.server, e3?.host, e3?.address), r2 = $(e3?.port);
    if (!n2 || !r2) return null;
    let i2 = e3?.metadata ?? {}, a2 = hm(Q(i2.countryCode, i2.country_code, e3?.countryCode, e3?.country_code, i2.country, i2.countryName, e3?.country, e3?.region, e3?.name, e3?.remark, e3?.ps)), o2 = Kd(Q(e3?.name, e3?.remark, e3?.ps, `${n2}:${r2}`) ?? `${n2}:${r2}`), s2 = Q(i2.country, i2.countryName, e3?.country, e3?.region);
    return { id: Q(e3?.id) ?? `${n2}:${r2}:${t2}`, name: gm(o2), protocol: Q(e3?.protocol, e3?.type) ?? `vpn`, server: n2, port: r2, country: s2 ? Kd(s2) : ym(a2) ?? `Страна не определена`, countryCode: a2, city: Kd(Q(i2.city, e3?.city) ?? ``), favorite: String(i2.favorite ?? ``).toLowerCase() === `true` };
  }).filter((e3) => !!e3) : [];
}
var mm = { germany: `de`, deutschland: `de`, германия: `de`, netherlands: `nl`, нидерланды: `nl`, holland: `nl`, france: `fr`, франция: `fr`, usa: `us`, us: `us`, "united states": `us`, "united states of america": `us`, сша: `us`, америка: `us`, finland: `fi`, финляндия: `fi`, poland: `pl`, польша: `pl`, uk: `gb`, "united kingdom": `gb`, великобритания: `gb`, russia: `ru`, россия: `ru`, turkey: `tr`, турция: `tr`, sweden: `se`, швеция: `se`, singapore: `sg`, сингапур: `sg`, japan: `jp`, япония: `jp`, spain: `es`, испания: `es`, italy: `it`, италия: `it`, austria: `at`, австрия: `at`, switzerland: `ch`, швейцария: `ch`, canada: `ca`, канада: `ca`, czechia: `cz`, "czech republic": `cz`, чехия: `cz`, ukraine: `ua`, украина: `ua`, belgium: `be`, бельгия: `be`, romania: `ro`, румыния: `ro`, bulgaria: `bg`, болгария: `bg`, hungary: `hu`, венгрия: `hu`, ireland: `ie`, ирландия: `ie`, portugal: `pt`, португалия: `pt`, denmark: `dk`, дания: `dk`, norway: `no`, норвегия: `no`, india: `in`, индия: `in`, korea: `kr`, "south korea": `kr`, корея: `kr`, brazil: `br`, kazakhstan: `kz`, казахстан: `kz`, bhutan: `bt`, бутан: `bt`, uae: `ae`, "united arab emirates": `ae`, оаэ: `ae`, "объединенные арабские эмираты": `ae`, "объединённые арабские эмираты": `ae`, "hong kong": `hk`, гонконг: `hk`, бразилия: `br`, albania: `al`, албания: `al`, argentina: `ar`, аргентина: `ar`, australia: `au`, австралия: `au`, auto: `auto`, авто: `auto`, autoloca: `auto`, "автовыбор": `auto` };
function hm(e2) {
  let t2 = Kd(String(e2 ?? ``)).trim();
  if (/^(?:[a-z]{2}|auto)$/i.test(t2)) return t2.toLowerCase();
  let n2 = _m(t2);
  if (n2) return n2;
  let r2 = t2.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ``).replace(/[()[\]{}|,:;#/_-]+/g, ` `).replace(/\s+/g, ` `).trim().toLowerCase();
  return (mm[r2] ?? mm[t2.toLowerCase()]) || (Object.entries(mm).find(([e3]) => e3.length > 2 && r2.includes(e3))?.[1] ?? `xx`);
}
function gm(e2) {
  return e2.replace(/^(?:[\u{1F1E6}-\u{1F1FF}]){2}\s*/u, ``).trim() || e2;
}
function _m(e2) {
  let t2 = Array.from(e2).filter((e3) => {
    let t3 = e3.codePointAt(0) ?? 0;
    return t3 >= 127462 && t3 <= 127487;
  });
  if (t2.length < 2) return null;
  let n2 = t2.slice(0, 2).map((e3) => {
    let t3 = e3.codePointAt(0) ?? 0;
    return String.fromCharCode(97 + t3 - 127462);
  }).join(``);
  return /^[a-z]{2}$/.test(n2) ? n2 : null;
}
function vm(e2) {
  let t2 = hm(e2);
  return (/^[a-z]{2}$/.test(t2) || t2 === `auto`) && t2 !== `xx` ? t2 : `xx`;
}
function ym(e2) {
  let t2 = vm(e2);
  if (t2 === `xx`) return null;
  if (t2 === `auto`) return `Автовыбор`;
  try {
    return new Intl.DisplayNames([`ru`], { type: `region` }).of(t2.toUpperCase()) ?? null;
  } catch {
    return t2.toUpperCase();
  }
}
function bm(e2) {
  if (typeof e2 != `string` || !e2.trim()) return null;
  try {
    return new URL(e2).host;
  } catch {
    return null;
  }
}
function xm(e2) {
  let t2 = Number(e2?.expire);
  return !Number.isFinite(t2) || t2 <= 0 ? !!e2 : t2 * 1e3 > Date.now();
}
function Sm(e2) {
  let t2 = Number(e2);
  return !Number.isFinite(t2) || t2 <= 0 ? `Не указано` : new Date(t2 * 1e3).toLocaleDateString(`ru-RU`, { day: `2-digit`, month: `2-digit`, year: `numeric` });
}
function Cm(e2) {
  if (!e2) return `Нет данных`;
  let t2 = Number(e2.upload ?? 0) + Number(e2.download ?? 0), n2 = Number(e2.total ?? 0);
  return !Number.isFinite(n2) || n2 <= 0 ? Gm(t2) : `${Gm(t2)} / ${Gm(n2)}`;
}
function wm(e2) {
  return e2?.connected === true && e2?.egressVerified === true;
}
function Q(...e2) {
  for (let t2 of e2) {
    if (typeof t2 == `string` && t2.trim()) return t2.trim();
    if (typeof t2 == `number` && Number.isFinite(t2)) return String(t2);
  }
  return null;
}
function $(...e2) {
  for (let t2 of e2) {
    if (t2 == null || t2 === ``) continue;
    let e3 = Number(t2);
    if (Number.isFinite(e3) && e3 >= 0) return Math.round(e3);
  }
  return null;
}
function Tm(e2) {
  let t2 = String(e2?.phase ?? ``), n2 = Q(e2?.profile), r2 = $(e2?.index), i2 = $(e2?.total), a2 = r2 && i2 ? ` ${r2}/${i2}` : ``, o2 = $(e2?.pingMs);
  if (t2 === `preparing`) return { tone: `info`, title: `Автоподбор профилей`, detail: `Сбрасываю прежнюю службу и owned WinWS перед проверкой` };
  if (t2 === `profile-start` && n2) return { tone: `info`, title: `Автоподбор профилей`, detail: `Проверяет профиль ${n2}${a2}` };
  if (t2 === `profile-result` && n2) {
    let t3 = String(e2?.result ?? ``) === `success`;
    return { tone: t3 ? `good` : `warn`, title: `Автоподбор профилей`, detail: `${n2}: ${t3 ? `успех` : `ошибка`}${o2 == null ? `` : `, ${o2} мс`}${a2}` };
  }
  if (t2 === `complete`) {
    let t3 = Q(e2?.bestProfile);
    return { tone: `good`, title: `Автоподбор завершен`, detail: t3 ? `Лучший профиль: ${t3}` : `Рабочий профиль не найден` };
  }
  return t2 === `cancelled` ? { tone: `warn`, title: `Автоподбор остановлен`, detail: `В истории оставлены только полностью проверенные профили` } : { tone: `info`, title: `Автоподбор профилей`, detail: i2 ? `Готовлю проверку ${i2} профилей` : `Готовлю проверку профилей` };
}
function Em(e2, t2) {
  let n2 = Number(e2);
  return Number.isFinite(n2) && n2 > 0 ? n2 : t2;
}
function Dm(e2, t2) {
  return { host: t2.host.trim() || String(e2?.host ?? Bf.host), port: Em(t2.port, Number(e2?.port ?? Bf.port)), secret: t2.secret.trim().replace(/^dd/i, ``) || String(e2?.secret ?? Bf.secret), dcIp: Om(t2.dcIp), verbose: t2.verbose, bufKb: Em(t2.bufKb, Number(e2?.bufKb ?? Bf.bufKb)), poolSize: Em(t2.poolSize, Number(e2?.poolSize ?? Bf.poolSize)), logMaxMb: Em(t2.logMaxMb, Number(e2?.logMaxMb ?? Bf.logMaxMb)), checkUpdates: t2.checkUpdates };
}
function Om(e2) {
  return e2.split(/[\n,]+/).map((e3) => e3.trim()).filter(Boolean);
}
function km(e2, t2) {
  let n2 = Number.isFinite(t2) ? Math.max(0, t2) : 0;
  return [...e2.slice(-13), n2];
}
function Am(e2) {
  let t2 = Math.max(...e2, 1);
  return e2.map((e3) => Math.max(5, Math.round(e3 / t2 * 100)));
}
function jm(e2) {
  let t2 = e2.replace(/[\u200b\u200c\u200d]/g, ``).replace(/[<>"'`]/g, ``).trim();
  if (!t2) return null;
  let n2 = t2.split(/\r?\n/).map((e3) => e3.trim()).filter(Boolean);
  if (n2.length !== 1) return null;
  let r2 = n2[0];
  if (/\s/.test(r2)) return null;
  let i2 = Mm(r2);
  if (i2) return i2;
  let a2 = r2.match(/^([a-z0-9-]{3,64})\.dns\.gravityless\.space$/i);
  if (a2?.[1]) {
    let e3 = a2[1].toLowerCase();
    return { protocol: `DoT`, provider: zf.provider, source: r2, dohUrl: `https://dns.gravityless.space:8443/dns-query/${e3}`, displayEndpoint: r2.toLowerCase(), upstream: `dns.gravityless.space:8443`, token: e3 };
  }
  return r2.match(/^dns\.gravityless\.space:8443\/dns-query\/([a-z0-9-]{3,64})$/i) ? Mm(`https://${r2}`) : r2 === zf.stamp ? Mm(zf.dohUrl) : null;
}
function Mm(e2) {
  try {
    let t2 = new URL(e2.trim());
    if (t2.protocol !== `https:` || t2.username || t2.password || !t2.hostname) return null;
    let n2 = t2.pathname && t2.pathname !== `/` ? t2.pathname : `/dns-query`;
    t2.pathname = n2, t2.hash = ``;
    let r2 = n2.match(/\/dns-query\/([a-z0-9-]{3,64})/i)?.[1]?.toLowerCase(), i2 = t2.toString();
    return { protocol: `DoH`, provider: Nm(i2) ?? `Custom DoH`, source: e2, dohUrl: i2, displayEndpoint: `${t2.hostname}${t2.port ? `:${t2.port}` : ``}${n2}`, upstream: `${t2.hostname}${t2.port ? `:${t2.port}` : ``}`, token: r2 };
  } catch {
    return null;
  }
}
function Nm(e2) {
  let t2 = typeof e2 == `string` ? e2.toLowerCase() : ``;
  return t2.includes(`gravityless`) || t2.includes(`dns.gravityless.space`) ? zf.provider : t2.includes(`cloudflare`) || t2.includes(`1.1.1.1`) || t2.includes(`1.0.0.1`) ? `Cloudflare` : t2.includes(`quad9`) || t2.includes(`9.9.9.9`) ? `Quad9` : t2.includes(`google`) || t2.includes(`8.8.8.8`) || t2.includes(`8.8.4.4`) ? `Google` : t2.includes(`127.0.0.1`) ? zf.provider : null;
}
function Pm(e2, t2) {
  return t2?.running || t2?.active ? `Активен` : t2?.lastError ? `Ошибка` : e2 ? e2.lastError ? `Ошибка` : e2.running === true || e2.ownedResolverRunning === true ? `Активен` : (e2.mode === `system-doh` || e2.mode === `gravityless-dns`) && e2.running === false || e2.severity === `blocked` ? `Ошибка` : e2.severity === `warn` ? `Требует внимания` : e2.mode || e2.title || e2.servers ? `Активен` : `Неактивен` : `Не прочитан`;
}
function Fm(e2) {
  if (typeof e2 == `string` && e2.trim()) {
    let t2 = Date.parse(e2);
    return Number.isFinite(t2) ? new Date(t2).toLocaleString(`ru-RU`, { day: `2-digit`, month: `2-digit`, hour: `2-digit`, minute: `2-digit` }) : e2;
  }
  return typeof e2 == `number` && Number.isFinite(e2) ? new Date(e2).toLocaleString(`ru-RU`, { day: `2-digit`, month: `2-digit`, hour: `2-digit`, minute: `2-digit` }) : `Не обновлялось`;
}
function Im(e2, t2 = Date.now()) {
  let n2 = null;
  if (typeof e2 == `number` && Number.isFinite(e2)) n2 = e2 > 1e10 ? t2 - e2 : e2;
  else if (typeof e2 == `string` && e2.trim()) {
    let r3 = Date.parse(e2);
    Number.isFinite(r3) && (n2 = t2 - r3);
  }
  if (n2 == null || n2 < 0) return `00:00:00`;
  let r2 = Math.floor(n2 / 1e3);
  return [Math.floor(r2 / 3600), Math.floor(r2 % 3600 / 60), r2 % 60].map((e3) => String(e3).padStart(2, `0`)).join(`:`);
}
function Lm(e2, t2 = 2) {
  return new Intl.NumberFormat(`ru-RU`, { maximumFractionDigits: t2, minimumFractionDigits: 0 }).format(e2);
}
function Rm(e2) {
  if (!Number.isFinite(e2) || e2 <= 0) return `0 Б`;
  let t2 = [`Б`, `КБ`, `МБ`, `ГБ`], n2 = e2, r2 = 0;
  for (; n2 >= 1e3 && r2 < t2.length - 1; ) n2 /= 1e3, r2 += 1;
  return `${Lm(n2, +(r2 >= 2))} ${t2[r2]}`;
}
function zapretProfileKey(value) {
  return String(value ?? ``).trim().replace(/\.bat$/i, ``).toLowerCase();
}
function zm(status, profiles, history) {
  const results = Array.isArray(history?.results) ? history.results : Array.isArray(history?.testResults) ? history.testResults : [];
  const available = Array.isArray(profiles) && profiles.length ? profiles : Array.isArray(status?.profiles) && status.profiles.length ? status.profiles : Array.isArray(status?.availableProfiles) && status.availableProfiles.length ? status.availableProfiles : results;
  const nameOf = (row) => typeof row === `string` ? row : Q(row?.configName, row?.name, row?.configId, row?.id);
  const byName = new Map(results.map(row => [zapretProfileKey(nameOf(row)), row]));
  const good = new Set((Array.isArray(history?.goodProfiles) ? history.goodProfiles : []).map(zapretProfileKey));
  const bad = new Set((Array.isArray(history?.badProfiles) ? history.badProfiles : []).map(zapretProfileKey));
  return available.slice(0, 64).map((profile, index) => {
    const name = nameOf(profile) || `Профиль ${index + 1}`, key = zapretProfileKey(name), row = byName.get(key);
    const targets = Array.isArray(row?.targets) ? row.targets : [];
    const total = Number.isFinite(row?.totalTargets) ? row.totalTargets : targets.length;
    const passed = Number.isFinite(row?.passedTargets) ? row.passedTargets : targets.filter(target => target?.ok === true).length;
    const result = String(row?.result ?? ``);
    const tone = /error|fail|timeout|ошибка/i.test(result) || bad.has(key) ? `bad` : /success|^ok$|успех/i.test(result) || good.has(key) ? `good` : row && total > 0 ? passed === total ? `good` : `bad` : `idle`;
    const ping = $(row?.pingMs, row?.averagePingMs);
    return { name, detail: Bm(profile, name), tone, result: row ? tone === `good` ? `Успех${total ? ` ${passed}/${total}` : ``}` : tone === `bad` ? `Ошибка${total ? ` ${passed}/${total}` : ``}` : `Проверен` : `Не проверен`, ping: ping == null ? `—` : `${ping} мс`, passedTargets: passed, totalTargets: total, targets: targets.map((target, i) => ({ label: Q(target?.label, target?.name, target?.service, target?.key) ?? `Сервис ${i + 1}`, host: Q(target?.host, target?.domain, target?.url, target?.endpoint) ?? `unknown`, ok: target?.ok === true, ping: $(target?.pingMs, target?.tcpMs, target?.latencyMs, target?.responseMs) == null ? `—` : `${$(target?.pingMs, target?.tcpMs, target?.latencyMs, target?.responseMs)} мс` })) };
  });
}
function Bm(e2, t2) {
  let n2 = Q(e2?.description, e2?.summary);
  if (n2) return n2;
  let r2 = Q(e2?.fileName, e2?.file, e2?.path) ?? (t2 === `General` ? `general.bat` : `${t2}.bat`);
  return /fake tls auto/i.test(t2) ? `${r2} / FAKE TLS AUTO` : /simple fake/i.test(t2) ? `${r2} / SIMPLE FAKE` : /alt/i.test(t2) ? `${r2} / alternative WinWS profile` : r2;
}
function Vm(e2) {
  return { generalDomains: Um(e2?.generalDomains), includedCidrs: Um(e2?.includedCidrs), excludedDomains: Um(e2?.excludedDomains), excludedCidrs: Um(e2?.excludedCidrs) };
}
function Hm(e2) {
  return { generalDomains: Om(e2.generalDomains), includedCidrs: Om(e2.includedCidrs), excludedDomains: Om(e2.excludedDomains), excludedCidrs: Om(e2.excludedCidrs) };
}
function Um(e2) {
  return Array.isArray(e2) ? e2.map(String).join(`
`) : typeof e2 == `string` ? e2 : ``;
}
function Wm(e2, t2) {
  return t2?.running || t2?.active ? `good` : t2?.lastError ? `bad` : e2 ? e2.severity === `blocked` ? `bad` : e2.severity === `warn` ? `warn` : `good` : `idle`;
}
function Gm(e2) {
  let t2 = Number.isFinite(e2) ? Math.max(0, e2) : 0;
  return t2 >= 1024 * 1024 * 1024 ? `${(t2 / 1024 / 1024 / 1024).toFixed(1)} ГБ` : t2 >= 1024 * 1024 ? `${(t2 / 1024 / 1024).toFixed(1)} МБ` : t2 >= 1024 ? `${Math.round(t2 / 1024)} КБ` : `${Math.round(t2)} Б`;
}
(0, Ld.createRoot)(document.getElementById(`root`)).render((0, V.jsx)(O.StrictMode, { children: (0, V.jsx)(Tl, { reducedMotion: `user`, transition: { duration: 0.18, ease: `easeOut` }, children: (0, V.jsx)(np, {}) }) }));
