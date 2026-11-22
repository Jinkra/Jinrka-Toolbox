using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal sealed class ToolboxSplash : Form {
    private const int FadeIn = 200;
    private const int FadeOut = 260;
    private readonly Process launcher;
    private readonly string signal;
    private readonly Image logo;
    private readonly Timer clock = new Timer { Interval = 16 };
    private readonly Stopwatch time = new Stopwatch();
    private readonly bool animate = SystemInformation.IsMenuAnimationEnabled;
    private long closingAt = -1;
    private double closingOpacity;

    private ToolboxSplash(Process launcher, string signal, Image logo) {
        this.launcher = launcher;
        this.signal = signal;
        this.logo = logo;
        Text = "Jinkra 工具箱启动中";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        ClientSize = new Size(416, 153);
        BackColor = Color.FromArgb(248, 251, 255);
        Opacity = animate ? 0 : 1;
        using (GraphicsPath shape = Rounded(new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 22)) {
            Region = new Region(shape);
        }
        Shown += delegate { time.Start(); clock.Start(); };
        clock.Tick += delegate { Animate(); };
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    private void Animate() {
        long elapsed = time.ElapsedMilliseconds;
        if (closingAt < 0 && (File.Exists(signal) || launcher.HasExited)) {
            closingAt = elapsed;
            closingOpacity = Opacity;
        }
        if (closingAt >= 0) {
            if (!animate || elapsed - closingAt >= FadeOut) { Close(); return; }
            Opacity = closingOpacity * (1 - (elapsed - closingAt) / (double)FadeOut);
        } else if (animate && Opacity < 1) {
            Opacity = Math.Min(1, elapsed / (double)FadeIn);
        }
        if (animate) Invalidate();
    }

    protected override void OnPaint(PaintEventArgs args) {
        base.OnPaint(args);
        Graphics g = args.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using (GraphicsPath edge = Rounded(new RectangleF(.7f, .7f, 414.6f, 151.6f), 21))
        using (Pen line = new Pen(Color.FromArgb(200, 216, 238))) {
            g.DrawPath(line, edge);
        }
        g.DrawImage(logo, new Rectangle(27, 27, 66, 66));
        using (Font title = new Font("Microsoft YaHei UI", 20, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font caption = new Font("Microsoft YaHei UI", 13, FontStyle.Regular, GraphicsUnit.Pixel))
        using (Brush ink = new SolidBrush(Color.FromArgb(23, 44, 76)))
        using (Brush subtle = new SolidBrush(Color.FromArgb(82, 98, 123))) {
            g.DrawString("Jinkra 工具箱", title, ink, 111, 34);
            g.DrawString("正在启动…", caption, subtle, 112, 68);
        }
        using (GraphicsPath track = Rounded(new RectangleF(27, 116, 362, 5), 2.5f))
        using (Brush rail = new SolidBrush(Color.FromArgb(218, 230, 247))) {
            g.FillPath(rail, track);
            g.SetClip(track);
            float x = animate ? 27 - 105 + (float)(time.ElapsedMilliseconds % 1250) / 1250 * 472 : 27;
            using (GraphicsPath movement = Rounded(new RectangleF(x, 116, 105, 5), 2.5f))
            using (Brush accent = new SolidBrush(Color.FromArgb(56, 107, 179))) {
                g.FillPath(accent, movement);
            }
            g.ResetClip();
        }
    }

    private static GraphicsPath Rounded(RectangleF rect, float radius) {
        float diameter = radius * 2;
        var shape = new GraphicsPath();
        shape.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
        shape.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
        shape.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        shape.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
        shape.CloseFigure();
        return shape;
    }

    protected override void Dispose(bool disposing) {
        if (disposing) clock.Dispose();
        base.Dispose(disposing);
    }

    [STAThread]
    private static void Main(string[] args) {
        int pid;
        if (args.Length != 2 || !Int32.TryParse(args[0], out pid)) return;
        try {
            Application.EnableVisualStyles();
            using (Process parent = Process.GetProcessById(pid))
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png"))
            using (Image avatar = Image.FromStream(resource))
            using (var form = new ToolboxSplash(parent, args[1], avatar)) {
                Application.Run(form);
            }
        } catch (ArgumentException) {
            // The portable launcher may exit while the splash starts.
        }
    }
}
