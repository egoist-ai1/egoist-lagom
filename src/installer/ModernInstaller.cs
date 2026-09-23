using System;
using System.IO;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using System.Runtime.InteropServices;

namespace EgoistShield.Installer
{
    public class ModernInstallerApp : Application
    {
        [STAThread]
        public static void Main(string[] args)
        {
            string exchangeDir = args.Length > 0 ? args[0] : System.IO.Path.GetTempPath();
            bool monitorMode = Array.Exists(args, value => string.Equals(value, "--monitor", StringComparison.OrdinalIgnoreCase));
            bool busyMode = Array.Exists(args, value => string.Equals(value, "--busy", StringComparison.OrdinalIgnoreCase));
            ModernInstallerApp app = new ModernInstallerApp();
            InstallerWindow window = new InstallerWindow(exchangeDir, monitorMode, busyMode);
            app.Run(window);
        }
    }

    public class ModernToggle : Border
    {
        private bool _isChecked = true;
        private Border _thumb;
        public event EventHandler CheckedChanged;

        public bool IsChecked
        {
            get { return _isChecked; }
            set
            {
                _isChecked = value;
                UpdateVisual();
                if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty);
            }
        }

        public ModernToggle(bool initial)
        {
            _isChecked = initial;
            Width = 32;
            Height = 18;
            CornerRadius = new CornerRadius(9);
            Cursor = Cursors.Hand;

            _thumb = new Border
            {
                Width = 14,
                Height = 14,
                CornerRadius = new CornerRadius(7),
                VerticalAlignment = VerticalAlignment.Center
            };

            Child = _thumb;
            UpdateVisual();

            MouseLeftButtonDown += (s, e) =>
            {
                IsChecked = !IsChecked;
                e.Handled = true;
            };
        }

        private void UpdateVisual()
        {
            if (_isChecked)
            {
                Background = new SolidColorBrush(Color.FromRgb(255, 255, 255));
                BorderBrush = new SolidColorBrush(Color.FromRgb(255, 255, 255));
                BorderThickness = new Thickness(1);
                _thumb.Background = new SolidColorBrush(Color.FromRgb(0, 0, 0));
                _thumb.HorizontalAlignment = HorizontalAlignment.Right;
                _thumb.Margin = new Thickness(0, 0, 2, 0);
            }
            else
            {
                Background = new SolidColorBrush(Color.FromRgb(39, 39, 42));
                BorderBrush = new SolidColorBrush(Color.FromRgb(63, 63, 70));
                BorderThickness = new Thickness(1);
                _thumb.Background = new SolidColorBrush(Color.FromRgb(161, 161, 170));
                _thumb.HorizontalAlignment = HorizontalAlignment.Left;
                _thumb.Margin = new Thickness(2, 0, 0, 0);
            }
        }
    }

    public class InstallerWindow : Window
    {
        private string _exchangeDir;
        private Grid _mainContainer;
        private Grid _configView;
        private Grid _progressView;
        private Grid _completeView;

        private TextBox _txtInstallDir;
        private ModernToggle _toggleRunAfter;
        private ModernToggle _toggleDesktopShortcut;

        private TextBlock _lblStatus;
        private TextBlock _lblProgressTitle;
        private TextBlock _lblPercent;
        private Border _progressBarTrack;
        private Border _progressBarFill;
        private LinearGradientBrush _shimmerBrush;
        private DispatcherTimer _pollTimer;
        private DispatcherTimer _shimmerTimer;
        private double _shimmerOffset = 0.0;
        private double _currentProgress = 0.0;
        private double _targetProgress = 0.0;
        private string _chosenDir;
        private bool _runAfter = true;
        private bool _desktopShortcut = true;
        private bool _installing;
        private bool _monitorMode;
        private bool _busyMode;
        private bool _closingForHandoff;
        private bool _launchedAfterInstall;
        private Button _closeButton;
        private Button _finishButton;

        [System.Runtime.InteropServices.DllImport("gdi32.dll", SetLastError = true)]
        private static extern int AddFontResourceEx(string lpszFilename, uint fl, IntPtr pdv);
        private const uint FR_PRIVATE = 0x10;

        public InstallerWindow(string exchangeDir, bool monitorMode, bool busyMode)
        {
            _exchangeDir = exchangeDir;
            _monitorMode = monitorMode;
            _busyMode = busyMode;
            Title = "Egoist Lagom Setup";
            Width = 480;
            Height = 320;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;

            try
            {
                string fontFile = System.IO.Path.Combine(_exchangeDir, "Unbounded.ttf");
                if (!System.IO.File.Exists(fontFile))
                {
                    fontFile = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Unbounded.ttf");
                }
                if (System.IO.File.Exists(fontFile))
                {
                    try { AddFontResourceEx(fontFile, FR_PRIVATE, IntPtr.Zero); } catch { }
                    string fontDir = System.IO.Path.GetDirectoryName(fontFile).Replace('\\', '/');
                    if (!fontDir.EndsWith("/")) fontDir += "/";
                    FontFamily = new FontFamily(new Uri("file:///" + fontDir), "./#Unbounded, Unbounded, Segoe UI, sans-serif");
                }
                else
                {
                    FontFamily = new FontFamily("Unbounded, Segoe UI, sans-serif");
                }
            }
            catch
            {
                FontFamily = new FontFamily("Segoe UI, sans-serif");
            }

            var logo = GetHermesLogoSource();
            if (logo != null) Icon = logo;

            BuildUI();

            if (_monitorMode)
            {
                _chosenDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield");
                _runAfter = ReadRunAfterPreference();
                if (_finishButton != null && _runAfter) _finishButton.Content = "Закрыть";
                BeginProgressMonitoring();
                ContentRendered += (s, e) => WriteSignal("ui-ready.flag");
            }
            else if (_busyMode)
            {
                ShowBusyView();
            }
        }

        private void BuildUI()
        {
            Border outerBorder = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(9, 9, 11)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Margin = new Thickness(4)
            };

            outerBorder.Effect = new DropShadowEffect
            {
                Color = Color.FromRgb(0, 0, 0),
                BlurRadius = 20,
                ShadowDepth = 0,
                Opacity = 0.90
            };

            Grid rootGrid = new Grid();
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(36) });
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // Title Bar
            Border titleBar = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(14, 14, 16)),
                CornerRadius = new CornerRadius(10, 10, 0, 0),
                BorderBrush = new SolidColorBrush(Color.FromRgb(31, 31, 35)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseLeftButtonDown += (s, e) => { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); };

            Grid titleGrid = new Grid { Margin = new Thickness(14, 0, 10, 0) };
            StackPanel brandPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            // Real Hermes vector logo
            UIElement logoBorder = CreateHermesImage(20, new Thickness(0, 0, 9, 0));

            TextBlock brandText = new TextBlock
            {
                Text = "egoist / lagom",
                Foreground = Brushes.White,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center
            };

            Border badge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(7, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            badge.Child = new TextBlock
            {
                Text = "Lagom",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 10,
                FontWeight = FontWeights.Medium
            };

            brandPanel.Children.Add(logoBorder);
            brandPanel.Children.Add(brandText);
            brandPanel.Children.Add(badge);

            StackPanel controlsPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center
            };

            Button btnMin = CreateWinButton("-", 12);
            btnMin.Click += (s, e) => WindowState = WindowState.Minimized;

            Button btnClose = CreateWinButton("✕", 11);
            _closeButton = btnClose;
            btnClose.Click += (s, e) => CloseInstaller();

            controlsPanel.Children.Add(btnMin);
            controlsPanel.Children.Add(btnClose);

            titleGrid.Children.Add(brandPanel);
            titleGrid.Children.Add(controlsPanel);
            titleBar.Child = titleGrid;
            Grid.SetRow(titleBar, 0);
            rootGrid.Children.Add(titleBar);

            // Body Container
            _mainContainer = new Grid { Margin = new Thickness(20, 12, 20, 16) };
            Grid.SetRow(_mainContainer, 1);
            rootGrid.Children.Add(_mainContainer);

            outerBorder.Child = rootGrid;
            Content = outerBorder;

            CreateConfigView();
            CreateProgressView();
            CreateCompleteView();

            ShowConfigView();
        }

        private Button CreateWinButton(string text, double fontSize)
        {
            Button btn = new Button
            {
                Content = text,
                Width = 24,
                Height = 24,
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                FontSize = fontSize,
                FontWeight = FontWeights.Bold,
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => { btn.Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)); btn.Foreground = Brushes.White; };
            btn.MouseLeave += (s, e) => { btn.Background = Brushes.Transparent; btn.Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)); };
            return btn;
        }

        private Button CreateActionButton(string text, bool isPrimary)
        {
            Button btn = new Button
            {
                Content = text,
                Height = 38,
                Cursor = Cursors.Hand,
                BorderThickness = new Thickness(0),
                FocusVisualStyle = null
            };

            Style style = new Style(typeof(Button));
            ControlTemplate template = new ControlTemplate(typeof(Button));
            FrameworkElementFactory borderFactory = new FrameworkElementFactory(typeof(Border));
            borderFactory.Name = "border";
            borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));

            if (isPrimary)
            {
                borderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)));
            }
            else
            {
                borderFactory.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(39, 39, 42)));
            }

            FrameworkElementFactory contentFactory = new FrameworkElementFactory(typeof(ContentPresenter));
            contentFactory.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            contentFactory.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            contentFactory.SetValue(TextBlock.FontSizeProperty, 13.5);
            contentFactory.SetValue(TextBlock.FontWeightProperty, FontWeights.Bold);

            if (isPrimary)
            {
                contentFactory.SetValue(TextBlock.ForegroundProperty, new SolidColorBrush(Color.FromRgb(0, 0, 0)));
            }
            else
            {
                contentFactory.SetValue(TextBlock.ForegroundProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)));
            }

            borderFactory.AppendChild(contentFactory);
            template.VisualTree = borderFactory;

            Trigger hoverTrigger = new Trigger { Property = Button.IsMouseOverProperty, Value = true };
            if (isPrimary)
            {
                hoverTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(228, 228, 231)), "border"));
            }
            else
            {
                hoverTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(63, 63, 70)), "border"));
            }
            template.Triggers.Add(hoverTrigger);

            Trigger pressedTrigger = new Trigger { Property = Button.IsPressedProperty, Value = true };
            if (isPrimary)
            {
                pressedTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(212, 212, 216)), "border"));
            }
            else
            {
                pressedTrigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(24, 24, 27)), "border"));
            }
            template.Triggers.Add(pressedTrigger);

            Trigger focusTrigger = new Trigger { Property = Button.IsKeyboardFocusedProperty, Value = true };
            focusTrigger.Setters.Add(new Setter(Border.BorderBrushProperty, new SolidColorBrush(Color.FromRgb(255, 255, 255)), "border"));
            focusTrigger.Setters.Add(new Setter(Border.BorderThicknessProperty, new Thickness(1.5), "border"));
            template.Triggers.Add(focusTrigger);

            Trigger disabledTrigger = new Trigger { Property = Button.IsEnabledProperty, Value = false };
            disabledTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
            template.Triggers.Add(disabledTrigger);

            style.Setters.Add(new Setter(Button.TemplateProperty, template));
            btn.Style = style;
            return btn;
        }

        private void CreateConfigView()
        {
            _configView = new Grid();
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _configView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Hero Header
            StackPanel heroPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
            heroPanel.Children.Add(new TextBlock
            {
                Text = "Установка Egoist Lagom",
                Foreground = Brushes.White,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 4)
            });
            heroPanel.Children.Add(new TextBlock
            {
                Text = "Автономный комплекс сетевой безопасности и защиты",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 11.5
            });
            Grid.SetRow(heroPanel, 0);
            _configView.Children.Add(heroPanel);

            // Path Selection Card
            Border pathCard = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(18, 18, 20)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 10)
            };

            StackPanel pathStack = new StackPanel();
            pathStack.Children.Add(new TextBlock
            {
                Text = "Папка установки",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 11,
                FontWeight = FontWeights.Medium,
                Margin = new Thickness(0, 0, 0, 4)
            });

            Grid pathRow = new Grid();
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            string defaultDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield");
            _txtInstallDir = new TextBox
            {
                Text = defaultDir,
                IsReadOnly = true,
                Focusable = false,
                Background = new SolidColorBrush(Color.FromRgb(24, 24, 27)),
                Foreground = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(63, 63, 70)),
                BorderThickness = new Thickness(1),
                Height = 30,
                Padding = new Thickness(8, 4, 8, 4),
                FontSize = 11.5,
                FontWeight = FontWeights.Normal,
                VerticalContentAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(_txtInstallDir, 0);
            pathRow.Children.Add(_txtInstallDir);

            pathStack.Children.Add(pathRow);
            pathCard.Child = pathStack;
            Grid.SetRow(pathCard, 1);
            _configView.Children.Add(pathCard);

            // Options Card (Compact Side-by-Side)
            Border optionsCard = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(18, 18, 20)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 14)
            };

            Grid optionsGrid = new Grid();
            optionsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            optionsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // Toggle 1: Run after install
            StackPanel opt1 = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            _toggleRunAfter = new ModernToggle(true);
            opt1.Children.Add(_toggleRunAfter);
            opt1.Children.Add(new TextBlock
            {
                Text = "Запустить сразу",
                Foreground = new SolidColorBrush(Color.FromRgb(212, 212, 216)),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            });
            Grid.SetColumn(opt1, 0);
            optionsGrid.Children.Add(opt1);

            // Toggle 2: Desktop shortcut
            StackPanel opt2 = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            _toggleDesktopShortcut = new ModernToggle(true);
            opt2.Children.Add(_toggleDesktopShortcut);
            opt2.Children.Add(new TextBlock
            {
                Text = "Ярлык на рабочем столе",
                Foreground = new SolidColorBrush(Color.FromRgb(212, 212, 216)),
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            });
            Grid.SetColumn(opt2, 1);
            optionsGrid.Children.Add(opt2);

            optionsCard.Child = optionsGrid;
            Grid.SetRow(optionsCard, 2);
            _configView.Children.Add(optionsCard);

            // Install Button
            Button btnInstall = CreateActionButton("Установить Egoist Lagom", true);
            btnInstall.Height = 40;
            btnInstall.Click += (s, e) => StartInstallation();
            Grid.SetRow(btnInstall, 3);
            _configView.Children.Add(btnInstall);
        }

        private void CreateProgressView()
        {
            _progressView = new Grid();
            _progressView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            _progressView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _progressView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            StackPanel centerStack = new StackPanel
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            UIElement emblemBorder = CreateHermesImage(70, new Thickness(0, 0, 0, 16));
            centerStack.Children.Add(emblemBorder);

            _lblProgressTitle = new TextBlock
            {
                Text = "Установка компонентов...",
                Foreground = Brushes.White,
                FontSize = 17,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 4)
            };
            centerStack.Children.Add(_lblProgressTitle);

            _lblStatus = new TextBlock
            {
                Text = "Подготовка к распаковке...",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 16)
            };
            centerStack.Children.Add(_lblStatus);

            // Shimmering Progress Bar
            Grid progressGrid = new Grid
            {
                Width = 380,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            _progressBarTrack = new Border
            {
                Height = 5,
                Background = new SolidColorBrush(Color.FromRgb(39, 39, 42)),
                CornerRadius = new CornerRadius(2.5)
            };

            _shimmerBrush = new LinearGradientBrush
            {
                StartPoint = new Point(0, 0.5),
                EndPoint = new Point(1, 0.5)
            };
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(82, 82, 91), 0.0));
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(255, 255, 255), 0.5));
            _shimmerBrush.GradientStops.Add(new GradientStop(Color.FromRgb(82, 82, 91), 1.0));

            _progressBarFill = new Border
            {
                Height = 5,
                Width = 0,
                Background = _shimmerBrush,
                CornerRadius = new CornerRadius(2.5),
                HorizontalAlignment = HorizontalAlignment.Left
            };

            _progressBarTrack.Child = _progressBarFill;
            progressGrid.Children.Add(_progressBarTrack);
            centerStack.Children.Add(progressGrid);

            _lblPercent = new TextBlock
            {
                Text = "0%",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 8, 0, 0)
            };
            centerStack.Children.Add(_lblPercent);

            Grid.SetRow(centerStack, 1);
            _progressView.Children.Add(centerStack);
        }

        private void CreateCompleteView()
        {
            _completeView = new Grid();
            _completeView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            _completeView.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _completeView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            StackPanel centerStack = new StackPanel
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            Border emblemBorder = new Border
            {
                Width = 42,
                Height = 42,
                CornerRadius = new CornerRadius(10),
                Background = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 10)
            };
            System.Windows.Shapes.Path checkIcon = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M 3,8 L 7,12 L 14,4"),
                Stroke = Brushes.Black,
                StrokeThickness = 2.8,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            emblemBorder.Child = checkIcon;
            centerStack.Children.Add(emblemBorder);

            centerStack.Children.Add(new TextBlock
            {
                Text = "Установка завершена",
                Foreground = Brushes.White,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 4)
            });

            centerStack.Children.Add(new TextBlock
            {
                Text = "Egoist Lagom готов к работе",
                Foreground = new SolidColorBrush(Color.FromRgb(161, 161, 170)),
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 18)
            });

            Button btnFinish = CreateActionButton("Запустить Egoist Lagom", true);
            _finishButton = btnFinish;
            btnFinish.Width = 260;
            btnFinish.Height = 40;
            btnFinish.Click += (s, e) => FinishAndLaunch();
            centerStack.Children.Add(btnFinish);

            Grid.SetRow(centerStack, 1);
            _completeView.Children.Add(centerStack);
        }

        private void ShowConfigView()
        {
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_configView);
        }

        private void ShowProgressView()
        {
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_progressView);

            _shimmerTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
            _shimmerTimer.Tick += (s, e) =>
            {
                _shimmerOffset += 0.015;
                if (_shimmerOffset > 1.4) _shimmerOffset = -0.4;
                _shimmerBrush.StartPoint = new Point(_shimmerOffset - 0.35, 0.5);
                _shimmerBrush.EndPoint = new Point(_shimmerOffset + 0.35, 0.5);

                double diff = _targetProgress - _currentProgress;
                if (diff > 0.05)
                {
                    _currentProgress += diff * 0.08;
                }
                _currentProgress = Math.Min(99.0, _currentProgress);
                UpdateProgressBar(_currentProgress);
            };
            _shimmerTimer.Start();
        }

        private void ShowCompleteView()
        {
            _installing = false;
            if (_closeButton != null) _closeButton.IsEnabled = true;
            if (_shimmerTimer != null) _shimmerTimer.Stop();
            if (_pollTimer != null) _pollTimer.Stop();
            _mainContainer.Children.Clear();
            _mainContainer.Children.Add(_completeView);
            if (_runAfter) LaunchInstalledDesktop();
        }

        private bool ReadRunAfterPreference()
        {
            try
            {
                return File.ReadAllText(System.IO.Path.Combine(_exchangeDir, "run_after.txt")).Trim() != "0";
            }
            catch { return true; }
        }

        private void StartInstallation()
        {
            _chosenDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EgoistShield");

            _runAfter = _toggleRunAfter.IsChecked;
            _desktopShortcut = _toggleDesktopShortcut.IsChecked;

            try
            {
                Directory.CreateDirectory(_exchangeDir);
                var utf8NoBom = new System.Text.UTF8Encoding(false);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "install_dir.txt"), _chosenDir, utf8NoBom);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "desktop_shortcut.txt"), _desktopShortcut ? "1" : "0", utf8NoBom);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "run_after.txt"), _runAfter ? "1" : "0", utf8NoBom);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "start_install.flag"), DateTime.UtcNow.Ticks.ToString(), utf8NoBom);
            }
            catch (Exception ex)
            {
                ShowFailure("Не удалось сохранить параметры установки: " + ex.Message);
                return;
            }

            BeginProgressMonitoring();
        }

        private void BeginProgressMonitoring()
        {
            ShowProgressView();
            _installing = true;
            if (_closeButton != null) _closeButton.IsEnabled = false;

            string statusPath = System.IO.Path.Combine(_exchangeDir, "status.txt");
            _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
            _pollTimer.Tick += (s, e) =>
            {
                try
                {
                    if (!_monitorMode && File.Exists(System.IO.Path.Combine(_exchangeDir, "handoff-started.flag")))
                    {
                        WriteSignal("handoff-ack.flag");
                        _closingForHandoff = true;
                        _installing = false;
                        if (_shimmerTimer != null) _shimmerTimer.Stop();
                        _pollTimer.Stop();
                        Close();
                        return;
                    }
                    if (File.Exists(statusPath))
                    {
                        string line = File.ReadAllText(statusPath).Trim();
                        if (!string.IsNullOrEmpty(line))
                        {
                            string[] parts = line.Split(new char[] { '|' }, 2);
                            if (parts.Length == 2)
                            {
                                double pct;
                                if (double.TryParse(parts[0], out pct))
                                {
                                    _targetProgress = pct;
                                }
                                string msg = parts[1];
                                if (pct <= 0 && (msg.StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase) || msg.StartsWith("Ошибка", StringComparison.OrdinalIgnoreCase)))
                                {
                                    _pollTimer.Stop();
                                    ShowFailure(msg.Replace("ERROR:", "").Trim());
                                    return;
                                }
                                if (msg == "DONE")
                                {
                                    _targetProgress = 100.0;
                                    _currentProgress = 100.0;
                                    UpdateProgressBar(100.0);
                                    _pollTimer.Stop();
                                    DispatcherTimer delay = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                                    delay.Tick += (ds, de) => { delay.Stop(); ShowCompleteView(); };
                                    delay.Start();
                                    return;
                                }
                                _lblStatus.Text = msg;
                            }
                        }
                    }
                }
                catch { }
            };
            _pollTimer.Start();
        }

        private void ShowBusyView()
        {
            ShowProgressView();
            if (_shimmerTimer != null) _shimmerTimer.Stop();
            _lblProgressTitle.Text = "Установка уже выполняется";
            _lblStatus.Text = "Дождитесь завершения текущей установки Egoist Lagom.";
            _lblPercent.Text = "Идёт установка";
            _progressBarFill.Width = 0;
            _installing = false;
            if (_closeButton != null) _closeButton.IsEnabled = true;
        }

        private void ShowFailure(string message)
        {
            if (_progressView.Parent == null) ShowProgressView();
            _installing = false;
            if (_shimmerTimer != null) _shimmerTimer.Stop();
            if (_pollTimer != null) _pollTimer.Stop();
            _lblProgressTitle.Text = "Установка не завершена";
            _lblStatus.Text = message;
            _lblStatus.TextWrapping = TextWrapping.Wrap;
            _lblStatus.MaxWidth = 400;
            _lblPercent.Text = "Изменения отменены";
            _progressBarFill.Width = 0;
            if (_closeButton != null) _closeButton.IsEnabled = true;
        }

        private void WriteSignal(string fileName)
        {
            try
            {
                Directory.CreateDirectory(_exchangeDir);
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, fileName), "1", new System.Text.UTF8Encoding(false));
            }
            catch { }
        }

        private void UpdateProgressBar(double percent)
        {
            double trackWidth = _progressBarTrack.ActualWidth;
            if (trackWidth <= 0) trackWidth = 330;
            _progressBarFill.Width = Math.Max(0, (percent / 100.0) * trackWidth);
            _lblPercent.Text = string.Format("{0}%", (int)percent);
        }

        private void FinishAndLaunch()
        {
            try
            {
                File.WriteAllText(System.IO.Path.Combine(_exchangeDir, "finished.flag"), "1");
            }
            catch { }

            if (!_launchedAfterInstall) LaunchInstalledDesktop();

            Close();
        }

        private void LaunchInstalledDesktop()
        {
            if (_launchedAfterInstall || string.IsNullOrEmpty(_chosenDir)) return;
            string exePath = System.IO.Path.Combine(_chosenDir, "EgoistShield.exe");
            if (File.Exists(exePath))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        UseShellExecute = true,
                        Verb = "runas"
                    });
                    _launchedAfterInstall = true;
                    if (_finishButton != null) _finishButton.Content = "Закрыть";
                }
                catch
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            UseShellExecute = true
                        });
                        _launchedAfterInstall = true;
                        if (_finishButton != null) _finishButton.Content = "Закрыть";
                    }
                    catch { }
                }
            }
        }

        private void CloseInstaller()
        {
            if (_installing) return;
            if (!_closingForHandoff) WriteSignal("cancel.flag");
            Close();
        }
        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (_installing) e.Cancel = true;
            base.OnClosing(e);
        }
        private static ImageSource _cachedHermesLogo;
        private static ImageSource GetHermesLogoSource()
        {
            if (_cachedHermesLogo != null) return _cachedHermesLogo;
            try
            {
                byte[] bytes = Convert.FromBase64String(HermesLogoBase64);
                using (var ms = new MemoryStream(bytes))
                {
                    var bmp = new System.Windows.Media.Imaging.BitmapImage();
                    bmp.BeginInit();
                    bmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    bmp.StreamSource = ms;
                    bmp.EndInit();
                    bmp.Freeze();
                    _cachedHermesLogo = bmp;
                    return _cachedHermesLogo;
                }
            }
            catch
            {
                return null;
            }
        }

        private static Image CreateHermesImage(double size, Thickness margin)
        {
            var img = new Image
            {
                Width = size,
                Height = size,
                Source = GetHermesLogoSource(),
                Margin = margin,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            };
            RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.HighQuality);
            return img;
        }

        private const string HermesLogoBase64 = "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAADEaSURBVHhe7Z0HtFXF9f+fYi+gIhYSjVQrqIhijMaGsQKiJhgLUYwYNViiRrFgEkAFMRZUYkFEo4iAJmhEUECQLurDAMZHLw+pggnwEJHzX5+57Pv22XfmnHMfjyS//8p3rbPuuXOmz549e/bsmSkp+R/+h22M7UtKSnYrKSnZ8+yzzz6wdevWdf8bnh69e9d9/vnn6/bo0aNu7969C77/p56WLVvWpa621Bl1938LN99886FDhgxpP2nSpMdmzJgxfM6cOTMWLly4YMGCBYvLy8v/uXjx4rXb+ikvLy9ws9+/+OKLtc2aNVt7+OGHr50xY4ZzSwv3b3r+RV0tWrRoAXX3+eefj5g0aVKft95669p777336JKSku1snf/HceONNzYeMWLEPWVlZVNWrFixMfo/gJtvvjkqKSlxz1VXXWU//1fiq6++iubOnfvZBx988GDnzp2b2nb4t6Nbt24nTJky5ZWlS5dusJm12Lx5s3VyCLlnQThszt1+X7NmTfTdd9+599atW+cJ4Mc//rFz49vq1atjYYCNx4Lv2o+8W3f7PfQ/5KaxYsWK7z799NOhvXv3Psu2yzbHEUccccDYsWOfW7FiRSxTUmBdcJ+bddew/wU+v+Ke9r5gwYJo/Pjx0Zdffpl3b9WqVQEB8G3p0mXR2LEfRrNnz86HF9gyaXebt9B3n19x1+8+/75w69atiz766KMhl19++aG2nbYJ+vTp03bevHmLbEaSCuDzo1Fd7hZUTv/+/aNBgwYV9OxzzjknTwA//OEPY9/++c9/Rm+88Wb04osvRl9//XXsm4WvobYGWeOx/srLy9e89tpr19n2qlYMGzbsoX/961+xjGhkyXh1Iim9oUOHRjdcf0M0Yvhw+8nhjDPOyBPA8ccfbz87jB07NrrpppuiIUOG2E+JSMpXVZA1PvyNHTv2xZKSkl1t220tdp4wYcLrNkGBL4OWQkPI4qcYLFmyJPr5z38eXXXV1VF5+RL7OY+TTz45TwDHHHOM/ZzHypUro+uvvz5q165dtGhhAeOLQZd5a8plw9r/aSgtLR1fv379/WwjVhU7T548+R2biIXOZOg9hCx+sqBv375R/foNop49H7afCnBiixPzBNCkSRP7uQBPPNE7atSocfTMM8/YT3mEyl0d5bPxpcU5Y8aMT5s2bbr1RDBu3LhBEqnNhH3PkrHqgk4HYbRVq9bRD37wg2jihIkxfyEcd9xxeQI4/PDDo82bc7ODJHz66adR48aNo7PPPscJlGkI1UXIvVj42kCjtLR0SklJye62TTNj6NChPSQy3bi2wX0Zse72e3Vh2LBh0d577+0keSvoJeHoo4/OE0CjRo2ib7/91nrxAsHyvPPOj2rWrBn95S9/sZ+D8JXbutn/abDtYd/B+PHjh9h2zYRHH320NYWtCpIy5EMWPz507ny3a8Cbb7rZfsojFPeRRx6VJ4D69epFGzYUqjJCYcHdd+fSvvXWW/O6hRCS4rEI+dUdKuQnhJdffvkW276JOPnkk+vMnz9/KYGLSUxnMguq6hf2e/rpOSn+mWeejfnTCBHipk2bokMPPTRPAAcddFC0bu3a/HfrP+TGFJPwyBPz5s2LfRPYRrN1VMx7lrA2j2D58uUbb7zxxia2nYN4//33X7CR+BKQDNmMaX8+/xY+txA+mvJRdMABB7iKh/1rZI2H3l6/fv08Aey///5OS2gRyq/G6NGjo5133tkNQ+PGjcu7h8KF6kzXl8/dB983X9xg6tSpo207e3Hfffcdt3r16sKYDXQiNrFthUGDB0fbb799VHuf2tHHUz+2n/MIVaC8r127Nvr+97+fJ4Da++zjpnsavkoMYfr06dGBBx7o4nrppZfs50RkTUMjrd597gxTzz77bFvb3gUYN27cQAlkK8+XsO89S+VZP2n+n3zySVfBSPqzZhWqaS1C+QVr1nzter0QQK1aNaNly9yIl4eEz5rHBQsWuhkC8T344IP2cx42Tg2fe1I5rLuN25Zh2rRpzArCaNeu3SHLly/PS0M2MutWrLv1I/C5a7ceDz3kKrZhw4bRwgULY/40fPH4sGrVqqh27dp5Athjj91RpVpvwbyH0lm6dGl0dNOmLs4uXbrk3X3+cSvG3cLnR4f15Zehr0ePHqfads/j7bffvjcf6j8Influ3bq5Cm3QoGGqJg74Ci7v8n/58uXRXnvtlSeAXXfd1S0YaaRVcAjoJI46qomLt3PnzrFvobASb+h7CMX6B+PHj+9n212wHdoj7dlWYFXfNYpxf+SRR1xFfv9734vmzfVL2Rqh9G3cS5Z8Ge255555Athxxx1jq3++sDYO+18DblKvXk7IhIAtQvH70gq9h+Dzr+OeP3/+stq1a2NxFEeHDh0OXbVqVVAb4stcsSgm7KuvvuoqcM899mDssp8LoAsp/y3EbdGiRdFuu+2WJwAEy88//9x6DzZKFnzxxRfRvvvu6+J//vnn7eeC/IYQKlMobMhdgMKrV69ehTYEAwYMyJvFZEmouqHTmThxouuVVN6wd8LLEFXNG3P2XXbZJU8APJ999lnMT1Xj1mBaWKNGDRf/8Hf9q5KgqkRWVYwYMeIPtv1Lxo4d21s8+DIkFGszad18YTVC7gLYZ926dV2lPdLrEfvZwcaRlqZFWdmsaIcdcgQmz8cf56aVWctj/4fw3HPPufiROebOnWs/56Hr18at85CWNxtWoN1LS0vftu1f8tlnn70bCxGITGfC9z0Jaf75jk6fCmv3s5/ZzwUIxRdyF8yYMSPabrvtYgQwedJk6y01HouQ/2uvvdal0eKEFtGmwJpDKGzIPQ1J4WbPnj2zpKSkhm7/GmVlZdPFQ4iiQu8aIfcsuO+++1xFHXLIIV5LnFD6WdLUfljV043P8+GHH8b8+uL0uQmSvjH9OvLII106t992m/2cRyiOLO6+d1sOeS8vL1/ZuHHjfTUB7DZ//vyCOZZN2PdfP/abD3H3ynfGfemVqFeT4Ivbl4cQpkyZUkAAo0aOct9s5SXF63P3uYGpU6fm5YFRI0fazw6+9HR+ssLnV8e7bNmyDZdcckk9TQA1Fy1atNgGqG6E4vzmm2/yPQRz7azwVVQWTBg/oYAAhntMx4qJMwu63NfFpdWgfn23rCyw5bD/i4UNY4loxYoVFRdeeGGDfOuzY4cNCeLJRmAR+h4K63PT6Na1q6uYeoccEqsYC10Q37tFqCLHjBlTQABvv/12gV8bt/2v3X2w7hs3bswTulUSAZuW/PrcrR/rJu82D6CAANiSxK4Y61HDl1iSuyDkLkADJ3Pyv/71r7FvvrBSKPvN5xZyf++99woI4I0hb+T9C3TYrO5p+OCDD1x6O+20U1RWVmY/e/Prc0/zY/3q/14CYFuSDrAtoeNv3769q5Dzzj036MdXqCT3NNDbLQEMeHWA9VZ0vFlx+eWXuzTbtm0bc7fppf3XSPpmkUoAAtsIlpJsoknffEDDh+CHcMTULAk6bZuOzz0Jb775ZgEB9H/xxfx3HZ9Ny8Lnlga4HusPpDthwgT7OYZQ+r73UH6te2YC0EirZOtu//vQ9qKLXCUwT7awmU5zByF3i9cHDiwggL7P97XeHCQ9G7f9H3IDPvc77rjDpcsGFQvtP+3dxp3mDooiABtRdQEjCno/Klm7Eret8fLLLxcQwJ/+9CfrraDsPkKoKliRxLCUtD/5+BP7OYYsaWbxI0glgBAVFYO0sNd1vM4VvmPHjvZTDD6q1/C5pYH9A5YAHn/88fx3XX77aPethXAB5KAk+NK179av/a/dUwnABxuxRVImLDC/Yjm2xvbbu1UzH0KVHHK3SPLz1FNPFRCAz4onVKZQ3CH3EBYvXuw44K677BJ9uaRwF5Muq43b5279hJBKAFWJtBjAbql0tmgXg1BefO7WTf/v0aNHAQHcededBf5tJds4qwO/+MUvXPq9Hu5lP+URag+dr2LylkgAociSKiGrm+Ckk05yhbZWvcCGCxVYw/5Pw1133VVAAOz/E9iK9dWJz03ciwGzANLHikhpxvPQ6di68KUVctdIJIBtDZQfFPgHB//AacZCsAXxVUJVIatz+mHzp4Uv/SSE/ITcAd9EO8giVQghQvDBfrf/UwnABrD/k9xC7oKHH37YFdanChX4Cmvjlv/WXcP6F1QeDlG5JHzqqafG/Nq4bTr23ZcH68f3Dh544AGXB9YKfPCFTcqbIOSeSAC+AMDnHkogCcL+P/kkfeoTijuLe8gPqNwYWkkA7BSyW7xsJfvck9wENqwF5mjkgf2KFjp9Xzw2vjR3kEgA1Q2d8KJFC539HZVtMwh8BdTvvjBpqAyb+8/pH/vvJ3sCts8TQM09a0bLli6LhbPpajeLkHsI1n/z5s1dPubMmeP1E3r3IfRd3BMJwBbcF5mtGOseArtmKOQ999xjP+URSj/p3YdC99z/v//978oaKG4VNGnSpHiIhDR1/Pa/ds8KGRqfe/Y5+ymPUB58btrdIpEAgC8im5j+5oPP/6WXXuoKOXlyofmVhc2DRhZ3X/rg9YGvq0YXDpAjBBREGjasIJQ3n1tW/OMf/3B5CE2NbZq+8mk/Ni/6fyoBbAtUVFRE++yzj9uTx+5cDTJn9+f7CpJUqKy47bbbXEXnuAAEUMkFtFYyFLfP3eeWBGY/Vt4ATY5q4pbGGaayIEu6migEiQQQqvAs7xrWHfZKJXPoksWyZcuirz27c4EmBP3uQ5Z8cSBUZa+vlAF4jjjiiIJwofTT3nVYCxqYbWQWf/jDH1w+3hvxnv3kYOPW6fr8aDftnkgAGr7IssKGfejBB13hfPZ+2MthFmZh4wi5+eDzN3vW7Px+Ax8BIKAiI6TBVqh2zwK4nZihazAzIh+33367/RRDKP0kVIkAqhOnnHKKW/1iKNBYteqr6P3338//DxXMV2j7Pw2y1YzGrxwCKgmA5/e//70NlkcoD9YtC0aP/iBabg7aZGhkiDzssMNi7iFIusWmn0oAvghDBfW5Ae3O4Qv0vMsuuyzmB3AWHxbBAh3OpqkLHEo3Cccee6zq/fGGl6dxo0YxGcWXpi/9kFsIcAAfN5QzjFkosvClYRHyo91SCUCgA/kizQp6OIV6442c3Z3G00/3cWvjPmxNmgKJw2cIGnreeustG00MoXoJ5dfnzoFWvXs/aZ3zNoODBw+2n7zxhJDkN5UAQoFD7mlg3l9j+xoFp3hx1k9oGdam5XNLg/hH6m7ZsuWWBg73fnnQFPqsk4tNPw2sStqzhRgimQn86le/irkLQgTny1uozlIJQGATCEXog/Z3wgknRKecfHLsO/jzn/8cvdQ/fqSKL037P5QH61fAkTCyUzcLEXDmDyeOJsGXF/1f/1p/As4wfu65wp3Dbdq0cdpSC19aNt40d5CZAKoDVD7j/1NPFrK7jtd29J7KDWwBfAj50e6fflrq5twfTZkS7Wg2hPoehEMZm32rc7YR9Lv8t+4hQGTXXHONdY4GDBjg8rLSCImCpDh9sP5TCcBXEA1d2DTIerdlddP/Pt1pBn3wxW3TDL0L2I/H0EODci7wwoULo5EjR6rG9nOBv7z5phuqzjvvPPefA6ft0AXS0pf82rq05bj66qtjQjDglJEddtjBay8hsHGnvWskEkAosC1IVnTv3t2d7WPx29/+NurVK3ymr01fw7rb/2zz0ieB8mCChjk4hzXIHj379OzZk73zsQOkeMg/YYuBr+40xA31880e5RjDJnUksHH42kPXWcgdJBJAdUAndvbZZ0c33HBD7DuCDoLW3DnJ++WLeQcYm8imi9DToUMHd5p4pUKoxBEEmzQQvKx//eDHHiQhsHkRt5C7AC3o8c2PL9CEohX80Y9+FHOzSKqLJCQSQJZIQ36sf/43atiogJUh/MktHRah+Oy7/s+pX3d3vjvafffdCxrN93Cmnz4iZpedd8kfSpH2sKWL42GLPSxa3m0dgQvOPz/q3Tt/PocDegKOxFu/fn3MXRCK277rR5CJAHwZBdbd/teYM2eu02rZxQ0o+7FHH4u5ZYVOD07yxBNPxA59/Hc9DBMs4SLkVgW6HBw5a41BUEY1bdqU62Bi7gJfO1kCCCGRADSSIglBh3n99dejCy+8MPYdFsp47FsM0UhKG106YyfHvNuGSXvo+Sz6XHLJJVHXrl2dORbCKHcGZOUg+kE+wMrZqrhD8JWLwzA4QkYfUgHYL/D000/H3HzwxZmEVALwUVGWRKwfpHD07xqM0aedVml/J8iaFlMkK+AlPVQsB0tz+sjf/vY3twspFD9HJDBc/e7+30VntWwZ1a6tdQfJD8TIHUNVBR2l1QWtYm79Xnghuv5XldbKGqH64t1XPu2WSAC+wBpp3zUQuD6eOjX/f+WqlW7FjUYsFjQeQ4eteN9z1FFHRTd1usltN0/jNElgA8uwYe86G4Jjj5F1hOSH5WafGtfC1uO7w4e78Fq2mD1rlhNYLWxYQVb3RAJIgo0oCahSkar1Mm/Xbt2c9F3MuAlb1Dd8hZ7mzY93LJ2l5WLyWYzf0tJp0QMPPBi1cNfN+PUI8px22mnuHAKNpLQY1mrVquX2LAjwzwzKXs9nYXt96F2QSAC+AMAmot19YF1dn5KJPp5Tvq+44oqYvxCyTOm46QPz8qSTw7MiVI4Q2Np+//335236Qw+yBhthLXzp/ebWW6M99tgjJvk/+uijBbaKwBceJLWTuCcSgA1UVXAIg2aFr77yiqsQLnDUsGnAOZgDUxG2MnkQ1GCLDAm+Wz4s0noDCLlrhPwgrbPayfWze+21d0F+edj/h1KHq18Fvvg4IwH/+mIqFFNDBsevrQuVyRenD6kEYCNK+y/Q7q+99pozdBQwHeT4t1BYgLYNf7YCeZC2u3XrXqBSBqE4Q+4aPj+4+dzTgG7/scceczMKm38eyv/KK6/Ewth0mPpxg4nYJKDCZjt7Emwc9r9FKgEAWwnybiO3/wVvvvFmfmr07rvvugro3v2B/HcdDsEnxO6xl+/Xr19QIeKDzZOvHBa2vBohd+D7RuMxBcYKypaH5+KLL3YNK9BxMO3Dj9hOEBfvPiNSYMumH+tP3DITQFVBY01UR5/I6Z++3sutnN/73vcKKonrXLNI0z6E8h5yLwbFxsFQpW8plWe//fZzB2JboBpGUG7WrFneDRnAd3CmhiUEHzIRgKaUtIhCILPli3MXMLAHgAKfeeaZMT9IvfoKd3lgnwMGvBbzm4SkvCR9+3eDq2wrLZIrH0zRrRIJwZFvWDEBzk9G3R2CbTP7rt1AKgHYiKy7hv0PmPrJGHbRlnOA9NgH+9NXt/Jw6RKqVWsdDOt7d9i7bnn2/PPPj1544QUnW4RYooYtQxpCfkPuGvPnz3cGHmjvWl1wgWtw314HDqeoU6dOrOwtWrSIHSQtQ6acH7Tp200FROKDLq9tu8wEUJ2YOXOmKwiqX1kPYO0bIUdXAFI9FajhMv3dZjd9hFUybuplWlgou2ggmlGjRrk7ALIQxVZjc05mGTtmTPTE409El7a71Al3ki/m8j/5yU+cJM9QSJ42m3yR1yuvvDJWB9yEhsQPIBxZ3/CZjwtsI/vgc08lAB8VhdytHw00gRTioYcecv8Z0+V4NB4a1KcVJE44yMZvNsYon5vLUfSwcvbTn/60gJDoWew+vqZDB5fmwIEDnSIJjkGjoYCyvVKDb/hBe8jRNePHjYsGDxrEBQuOVSPUye1gugwQIn4gbm08sqGiIvpmwzeuB3/3XWE9UR9a/kFLCocD/OIGB/Uh1Aa+9sjEAXwnhfoiywrYPAWQs3+lQPLAzukJPtBjaHwag17kZIry8vxYCFHAGahstlZjxYtxKWbn3AReS90HpB9s/VgboBHptUwteerVqxfVPfBA9w0/NhwPXAwVM+MzeweYsrKwhbqYYatiwwY3zyePlIu8kU/KQFm+27TJcTQLpo6sA+i0WOEE9957r/vvu83EhzRCEHgJoDqGAJ0ovZ8LnYE9let3v/udCpUDPe7Xv/51rqI2b46+2bDB9XjGQx6GCLZOl5aWutO+edDGYVOI5IxfFEMokjAznzVrluuR3O9L+ljgojVEtQr7hYNg4EHl06i4obq+88473S4mLnpg+oXiCg4iaUijkgb5IQ8IuqQFu6YcuKMGRhnGngjKIsMACiGfUYk9twjrJIBMYU8UtbA9PKnxQSoBpEWg4fNLo8iFD2LgyMNpWAhKPnC9Cn5kMUQqmobGqqhZs2Oj3/zmN64x6X0IWfzSwFQ0FQ67Z/0cNTSNQG+kV0IUIpjayhLgxniNH/ySNmHpocSFOpe42cgijUv6TGMhFMrFuI+xCFM4pn6UyRHN+twwBidjisfU0Ie333rbyRBSX3369HHuLFd/WlpqvXuRVD5xTyWArQGJvDZggGPVTGNkLz5m2VReCDQ4d/n97e1c5dCbYaPEQ2/GeFIqBksZFltQHkEULAKhM2ddHqURMw4ahNVAlncxBiUvNAg9lR4LYdGgPLxLL8YPflHvvvPOOy4O4kIQJW4a5Y9//KMbBm655RYnwHK8jBYE4S6odck7RIQsACh/rZq1otVfFRqZCtgfePDBB+fjgtAgYJaa7a5qkKXnW/dqIQAbqYDeA6XDsoWaEdaybLo88cQTXQ8C327c6HoPAhkchcUh2LJVsyI4se2cWzsRABHI0MuzC5kxFKNUbBIYV9Gy0UuJB+NQuAkP77jxDT/4RahjMYs4kGOIk7hZkmYRimkraeu8NGjQwBEi3II8w82Y/SADANY4jjziiFiZffWIwkxU4gjNEBM2gyFtqI0jjSgSCSAtcBbASo85Jme0gZQbOgzSgpMzxTSKtJGgGUMRqhg36aUIfIzVaTZ8LMDAUehNGGtghErjwZoZUtArXHDBBe7AKARS3FBWoZ9A/UwYOA2cS89cfA8EyConQwF5RC5wguCa1Y6TifCHRhROlgUI0QioxA/BWf2IwLaRsPqQO0gkAB2gqqAXk/G999rLK/CEwNjIGLlqZU7rBSF9u2mTGwrYLAkXgT3jD4UKwlsaIWzLh2knXIEhAVaNDELvJ6/kOTf9ywl/DHGscL785z+bUofres7s2flpp+9A7aoilQBCGdII+RFhjrH/fWMQAZI4DIYPhB30ek5QhIXKLlmGAyRx5AHGbGYGrDjCqpHgmaJpS99t9cBZ4A5MOdE1IBuQF/KkZyQu/0u+zAu1sinFtx4isPUB4CgyNUUm8UH3elu/8l+7pxKABLCRpQEhhXk4mWVZ1MIXn40XCZqxHDB2Urli8AE7ZUhYUr7ETc1YJEHIY6bB7eJMsZjWISfAlu3VcFV90A9gSEpv5/AG0oL4aBDyQF6YLSD7iI0CnO+ddyptFgiLviENtt4Bwif5ILyVA2ydhupVu2UigKoAYYqMtt4y/9fwZcgHehVxiDUsLBQJWLZs8x92SmUv/XJpNGf2HCc5s58PiZ21czSFWOugvWOMZ5dN/fr13XgOl2DblSYO3nFjrIdwkOiRGZANYL0YlBIn+xlIg7RI0wl6S5fmGr5iQ57djxgx3AmXchKqNKA29yoWcsAWqu80WKKw74kE4AuQBQgpCFy77rJrtDh+AVkqnNp1i6UQUr+oeJHMBfQ6vXnCzdc3fBOt/ddap41D6CIelDFMt+AMzNFptGeffdZJ50j1KIOYvnE2MARCAyNUMmuAgzC9Y0wnDMSEupbra4mTRv/HF1+4tEiTtJ2qV03PyDOzDlH9ytF4qIxF8zl1i66iGKB4YlYFEa/dMsQIfD1f3PQjyEQANlAakIAp6L33FH8D/erVaxzrl00QLCLtV2c/F5+oRQHDyu2330Hucg5blDfo8JlrM/Yy94YdM9aiQkVzyDhKA74/8n23bxAhEo6CMokezS9CHETD/B+/sHbCwt6Jizi/WrUqp3Gs2BB9u/HbgkUeOMXDWzR4QF8bKzuNGRqwI2QY8yGp3uUswRf7hc3PQ2EzE0BVwZQKCT502kcaYLes8InhA1MppnGW7cEFLm3XLrhj1y0ibcwtItFY+EO4FIES/QRLr7BvBEoe3tH28Q0/+CUMYUX9S5xI9b4KXr++IrrqF1c5ziGA45B3zkViAQug0GHW8qMtMk4abFrkhTUJ9CVbg0QC0BRoMxDC+nXr3PjJeFtVSG/RV8fBclG44K7XD2CrHDgROlsASDlEvUsDwq7hFKhmEabWr+NZ535pZHo2Q5lr7E25KVxaHUAwZ511Vl5tCxhqyDPyhr4USmYCPXtUcgmBTicpTdGIMtsQ2LC+8NuUA8gpl7oSioVYxLIJAy4iFrRMr0SjyNgtgI1z6FPs1q38yFBYAXnwKfQ56ZsHsHUETG26hoxBXrFeFtU3nIQhRM4BtGbetgF97wI56ZTbT5PgCytIJYCkwALtRw6BtBshQpCwOg56HEYRTZoc5Xo+KlwB8csFS6hkBdz4jRUtUzIfYuWQ983K3faWmPfCnqT/I0Mw5UXvIbjuutw9SOgKxJwLsFaBHIKW0XdUnq8+QpCzBJFbssBHUNVCABoIS2Rq9KjKY89CcYTcgVjJICghnetdxfR0IQKMJEQ1ioDW/LjjMnOfXMPKn7i7D7px5J1pXdMmTfPr9BCvTNPYPi6WPYChpv2V7Z1f1g6QddIQygugbkhHp6HhI1zrnkoAxQKBibm0z7pHI5QxgVznxuobHOCD0R/E/KJqlR28nPolW8xgsfTGUKUIfOknQfuXd3o8mkC9bI0ATJ4Qgq22Dv8MC2Lnp28n8yEtj3LkXlnG9RUfUglAU72Gr0IErMZlOdrM91+AUEfhMIKAxcE6LagAUY2efvrpeU3bhx+OjU499TTrPY9QmsW6tzyzZb6R4UIIgOSFU0Z85wuy/RzTNOQX/E0rnWa9OJBeqH71O8IwsyNr2ubLr41TkEgAoYR9EWnQY5HYrWGmjSMpHr5BSMybYXWXX3G59eLAnF2WYn/5y1/m3WHDbMiwsHnwuaXlC9Dw56o7jlEekQceu+NHgL0AZUG7yBTQNpxFWl5YocRyKoQs5UskAB0oDdoPChgaJXThQSg+mznpKbB7Cop84QMmU1L5cqwbcsIF519gveaRlAcLn1ub1m3y1jwijPFgRuZDWdksdy2cyEi8++BLywc4CfH4bloNxWHrFyQSgKUcDfnvixTAsmHPSbtYbPw2HiqYQtL46ASSLpdCe4hfrIME6CJE8eKDTT/0rssK0E6eeWbL/H/s9EibNfvQWj1cEc6Aehm/qKUtbPk1dD6Qd1AC+U4U89Wjddffq0QAvgSAdof9s+jSJnDrhUYoblb7mPejREFjx3VuIe0iY670QlG1ImRhxROCr0J8/60byh3Z7o7eQ46aQykVRy4MMxhWANEwor9HQPQdAG0RqhfqAfsDO4XUCDW4dgeJBLC1QIVLxdibMG2GfO8CuU3z7rvvdsLgbb+5zXpxICzLtPgVUzJUuxe2iZ9LFIIv7RAwPvlsWk6A69Kli0uTxa9Q72dYeOWVV/NH1PtuCRf48qHd5KbV8ePiW+s1fHGEkEgAoYiS3ePfnn4qt8MVYc35Ud98FGr/o/0jPDIFPRtT7vcCUzwxp4bziIB1ycUXx9TEIYLL8g6WLCmP2l54Yd5dbB7s2C/f0QAyk4GDiZGKPSpP+0+CnB6uFWNJCMWp3TMTQCiyQuT80QDfbDGAlF1B04tc9hTA8ghPZWMfhwDmGwpoaNby8StjPw0T0klkL1MlIOSbOnVy7yw5ywxEH+Em8aKTwL6QPMuuYP5XBXCznXbcMX/SGmsUlbMIfzkkH7YdMxOARjGVRcWwR0/GKMKe2KJFVHuffWJ74bMC5ZIYRd55511O7UuvEui8sTqGv4cezG1BQ/C6L0EO0PCV0bqx60hsE4Qd64smtX+0mSh9ZOkW24YsJ49bQOwY1GIdLLoOhpsxY8dm3ikEfHFnJoAw4pFisdO9W/cC6Z9GRGnRuFHjaI1n+VbDl1F6gOydYx0fIw0fKxQpW8ZZJPYOV3ew3hx86fig/aHjn/pRjrswryctvTAlfhmOeJjC4gfromKMYiUeJH6so3fbdddo/rz4plmWhCEurK9CkHik5+sHVAMB5EBvv/KKK511TegiaNgylYFJtu9Mn7QGYZUQ6Rc2D7vHJs8e3CwVjj9077BJemLSaWRp6QooFybfrOXT47H9Jy2r8mX6Sj3A7VBXM2WDa2noNEPpk3fM00mD8d8H1h5YNcUwVQxQk2DTqhYCwPQKFh1S/2rI9jBs8X27WyxshplZMDWEncIa0f5xZJuASpALIeRSSrR0ab3PpiPQ7hDdr667zr2zOYU1DxoYkzAB00JWKVGGMSthQUifkGIRShfI4RD6oCgNHZZ9FBiK2oO3NHxpVZEAKiPq3fsJl0mmaVmBX8L8bMuewSzQmUebhkTNNiyMIez5eXKWoJiQMf0aPKjwiJlQL9QsUoOeLsYoQsj6FG/sFjp16uTGeZRQEIg98jUJOk0x9pAd1VnQs2dO1pAt+CHodAoIYO+99661aNGimKTiqwwqnIMaSDDr8qsG0zPCho4/1fClz5SQoQCWzDIwjSzDClpI4pZzCGHJ7BlIgy8dDYxRX34pd0qX3Doq9/rBrrFehkvA/vmm7QMsktKS43KS9AUhoG8g7LnnnJtJ2VRAACUlJbsvWLCgYLO+zjA9QXapaLMtC1tId2DUlhsxGEflnN+s3EPik1+IAC0cQhhWtjLDwBiFeLl+FdAodp5uYfNq0wKd7+qct+CRaZ2c4MUwwJAkiiEpp403DWJCxswCTSggLnnXCMXNKinTUxbS7A7szUZoX758+YaLLrqoviaAHefMmVNW6aUyAIKPmDkxDofGG50x3uU/Yz429m8NzS2V0nPljBxtRCnh9Lv+zxRIKlg4AVa4ArgTdolY49AwpIt8krb6JvA1PvjlNb/Mb/hAzqCS9WKMTPfGfZjr+Qh+Vl1r49QQW0iMXZi9gFEjRznLYbsJxAcdN8MkVlXEd+stt3qFblBeXr66RYsW+2sCKJk+fXqByIkELoc5IdzMKlM0EoCvsIceepjTB0jFjPlgTF6Z4lu+BZYYAJXVp8+f3LvIBJqIOFqOOGUMZttWMWOjBfsPX+jXz72z54+4aRgBgho6/okTcoSJuba9+CEpftTcxMkjswo306hf3y2tpxGvL264IptbifM4ZWqvMXfu3C9KSkp2iBHAhAkTYmInCg+xvjmr5VmxY041bEPZnkSBGjVq7OLRB0Exp8eN1UN7aVIIq1audEKgsEY2V7BzVhQjMo7qsZ8lVObmVkcBfBUI6HmYdevj33knblnS5Wh5WLbMOtatXet2/2a5SQQwixI1sTZ7h3vtUKNGtM/eexdctBGCLQfTXxaiiBsCtdv0pk2bNiLW+GDgwIFuPkdDi7KDB+1bGiUCSwgCWSEkLsyiNWTtH7ZlN03aQgluueXWmFmV7BEEsguH6ak+f4hGglNk0UjSgMwktCTPbiU5l0A4DlNMPc3s83SfzDt4EdTkFDBt0ALkXMW9au2VOMcP1Y8GsxNpR+wo2UoHRo0a1dO2f0nfvn2PHjRo0GZ6FAGgTt+tnoIsGRDAFomTCxEt0JPzjd29PqHHgmEJ1a+PKLWRBjoDfTcvPYulWQBx0MAQzuRJk5yJtYzrEImeXqLIEpU0j77oWkBdcNafaAuTgCAsLJpTx6xeRI7M7XJfl5h7GkLtwUwJpRRxHnzQwU6AHzJkSGvb/oAx4XMpKBJvFoQStu7cv0e8MqUSsHiCGRjfzs04BcIIE8tcCwhIbxFHUJRj1wTIDrLjSD9UkhVwmffba2R80yxkDW2UkgQ5OBMOYIcLzjvim++SCGDrNCvoeKoMq/fcc8/atvEdjj766F76FEsEHt+Fz1WFFN6aedGrxeQ7ixKEoYRNIT5AGPaoNzmTl2FGpGQ4HQstWPjK3UPMcmTT5sDXcuZX8jCWIhf5QF5C9aQbjSt0iAtNod0cIkImRqaWK1QVLEoJt+Ghjps3b/6Gbfc8Ro8efcznMz/fjDmWPv+GQ49YmNlaUDAseZFw7dm3LLlKemmm04Bh4OUCa5wcqFwZys484wzHZdAeihsVwxSJYYF8MMVkDZ9vEAjr+Iy/aPZww6DTcgcBc24IKA0in/DYu4XgXOyLpLHsFNLCxwVw0+4I2yjEJD0eVNXoRsaNG9fGtnsMs2aVue09SKmadUA9jCe+DPgQ8kfFN2nS1E1RLJA5JD1W/5KAOVjDBg0LrJAFKGhQNiFJ84gRB1MvxnjsCVlp5GF3Eayd5Wz8oF+HYIi7S5f7gwdagkMbH+oxC4sD7aDYLKBNtOBAjIYNG6XOVHx1at2Qt1iFlHpk/4QQ75IlS5j+7WjbPIZevXqdqc2c6JkociRC9OCTJhZeYRKCzSCgRyKk6fV9geywoRBJmz8B+/I4CCIJNGLzLad0YyeAECYrevrBZBuOIBs4IIJ1a5OvkP/jI3+M6QV8gLBEg+ozDGGpmWFXb/bMCp0X5vtMkaU8CNX2uP3+/ftfa9vbi4kTJ8Y2nsG6n3ryqdg5uYzVPor1wbIowOIJQ4HVBjIHZ0yVQiRNhZiG7VBjh9g+PAu2dLN2ztoFXEGfwWcfGoJZAMop5s7sFg6BGQe92o7lGnQkZgfEzVTYDnusM4jxa1UBQaPyljIg4KIHsVrAGTNmlBYof0K45pprGi5durRgdRAq1XNLxlS7Lp4FQgrM4cmw3dJFz5dt4fawZEtIsF/Uvz6NlwWsEHar7w3WD+sUw94ptN0DOl2EVmYNVusHtD8xbmUmwZK2BlNUhlUrECeDuCvjp9705ZnoIXyzFDpR165dT7PtnIgXX3yxo61sAZXN2CIJo8zQ6+MCG97+Bx9+OM6xW8vuMaKU+LH4EfjiQEXMEWx//Ut4kUqDdX2kdvYi8iDIJdkO6DSZgTBbQFOYBH32r12cgcvUr9/A6fyzQucBoZHlcIn/tFNPS1yFHDp0aA/bvpkwatSoxNuKkGbFZIsxnXlsCL6GE6CcOOWUHxewe12J2grou03fuXOANZBV6uxbZ6sOYkoD+/yQTez6Bb1OT9008dr8wJqx+Altabew9UY5RbNaZ999gzuxBJ988smYkpKSGrZts2LX0tLSREU9PV8PC7ChkEZPF8YWDGJCILIQzRgsF9YLCDly5KioV6/4tbRuq3jz5k4YsgRSLHT2GPoQ4JgtyIqdAE7AjSZSHrSNIoVjAWWBpVKW+4CBriNmMjfeeGO+njte2zHV2HTWrFnzTjrppLq2UYtC06ZN95sxY0Zu200CYOVI5WSOeTPStEao8fU7gheCkQbzYpnC2ZvImVKhgbMSNJXMqVy+S5mKBbefIfzCcvWUk5nMT35ytktLQO+WGRPyke0ILIDZu5RD0PWC+lnU0axJ+A7gtJg7d+7i66+//nDbnlVCvXr19p82bVrYyG0LqCDYtpzBR+VYaTQNzAqsvj1JKGQqyTq9JTj0BEj17E+w3CYrOv26k0vXjuHoCyAKrKM0yAt5xC7BCnfMVLJYKGmw3oHdn/R6pryhnUgas2fPnnP11VcfYdtxa7Hb+PHjMw1csGrZN89Ujp0+GkkNwjdUrlbzKJtGeeyFE0zz3L27xgIIFnnssc0cZ8q6tArWrVvvlnaRsO0UDSMUhiN9fB2QU8F4rGKIOLAtSFfxVtYLBCSbX1k0+uTjT2I+QygtLR17wgknfN82XrVh0KBBty5btixTt4adiwYs7YRLTRToAuh19ig49gRIJVslB1NKhgqmeVpzR7wQI1M83wqiJUa4GATDo7kXCzfIFrB2O6XDHE24nt4vANCVUJZiTNQZColru5LtosceS1eLA4ab4cOHP5yq6asO3HHHHc1KS0tHhNSwGvRkbtGiQAhSIeHMVgIVN3nylIL9BqKeZtqnr6Z12Lw56tjxOneHrz6tg7hRAIU2mWpg3wfb1zp5GhjB7ueX/ryABaN3F5N0uIauEwhuypSPgsY0OVSWG0WVrD8QlxU4Q5g5c+ZHPXv2bGnbaZujX79+P505c+a4tAUM0Lv3k65gKD/0lSm24TVg21SK9gNXEFUuUjmaMAvO6aVH6t0zKF523mkn7/5Cwddf/9MpbfSUU0zBLcsHcAhZbUPotMTNmkNWbSlEJoSURVagTsrKyv4+ePDgjpk1fNsKTz/99BmTJ0/uu3jx4sVJ4xy9RSxrtUFnsdDLx6F9Bm9tsbfTBpxHHH544pYqzhZmBiOAWFgV7d+/f8yfgBU20mD5OUkRkwYZ2lAbp+37W7JkyYqPP/54UN++fdv+xxveg1p9+vQ5a/To0b+fPn360Hnz5k0nw9ihr1y5smL9+vUVX331VcUNN9xQUVJSUnHuuedWlJWVOTf8iD959H/9Tjzdu3ev2G677Vw8Xbt2rVi1alUsLDjssMMq7rnnnorVq1dXrFmzpqJ9+/YVl1x8iUtP++XB7eoOV1e0adOm4uuvv3ZhevToUVG3bt2KtWvXxvyS1iOPPOLS5rnjjjtcnmycPJJvKZ88pDdnzpyKtm3bujiuat++YtmyZS7fubArKpYuXbpqwYIFn8+cOfPdMWPG9HjppZdaHXDAAXVspf83Y/s99thj3yuuuKJeq1atGrIZoVOnTg3GjRvXoGbNmmxMaFCnTp0G7du3b8C3rE+7du0aPP744w123nlnFwcPbjzi59prr23QrFkz54f4eU4//fT8fxsnbnw76aST8v7J45FHHunisulLujzkxRdn0oP/gw46yIUn3ZEjRza4/fbb3Tfq6rLLLqvP9Pu/sZf/D/8f4f8BvVKJ9fGf+yAAAAAASUVORK5CYII=";
    }
}
