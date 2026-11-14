import AltaMark from "./AltaMark";

export default function AltaSplashScreen() {
  return (
    <main className="alta-splash" role="status" aria-live="polite" aria-label="Loading Alta Chat">
      <div className="alta-splash-center">
        <div className="alta-splash-icon">
          <AltaMark className="alta-splash-mark" />
          <span className="alta-splash-orbit" aria-hidden="true" />
        </div>
        <h1 className="alta-splash-title">Alta Chat</h1>
        <p className="alta-splash-tagline">Private conversations. Beautifully connected.</p>
        <div className="alta-splash-loader" aria-hidden="true">
          <span /><span /><span />
        </div>
        <p className="alta-splash-status">SECURELY CONNECTING</p>
      </div>
      <span className="alta-splash-version">A QUIETER WAY TO CONNECT</span>
    </main>
  );
}
