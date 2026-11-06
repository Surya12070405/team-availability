import { Link, Route, Routes, useParams } from 'react-router-dom';
import Home from './components/Home.jsx';
import BoardPage from './components/BoardPage.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

function BoardRoute() {
  const { slug } = useParams();
  return <BoardPage key={slug} slug={slug} />; // remount per board so state never leaks between boards
}

function NotFound() {
  return (
    <div className="card empty">
      <h2>Page not found</h2>
      <p>That page does not exist.</p>
      <Link className="btn primary inline" to="/">Back to home</Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <Link to="/" className="brand">🗓️ TeamAvailability</Link>
      </header>
      <main id="main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/b/:slug" element={<BoardRoute />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
