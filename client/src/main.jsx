import { Component } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/index.jsx";

// If something throws while drawing the page, show the error instead of a blank white screen.
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20 }}>The page hit an error while loading</h1>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{String(this.state.error?.stack || this.state.error)}</pre>
        <p>Copy this text (and anything red in the browser console, F12) and send it to get it fixed.</p>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </ErrorBoundary>
);