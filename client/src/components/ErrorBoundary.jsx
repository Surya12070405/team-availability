import { Component } from 'react';

/** Last line of defence: a rendering bug shows a message and a way out, never a blank page. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('UI error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card empty" role="alert">
        <h2>Something went wrong</h2>
        <p>The page hit an unexpected problem. Your saved availability is safe. Reloading usually fixes it.</p>
        <button className="btn primary inline" onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    );
  }
}
