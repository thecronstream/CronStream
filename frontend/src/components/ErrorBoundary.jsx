import { Component } from 'react';
import ErrorPage from '../pages/ErrorPage';

/**
 * ErrorBoundary — wraps the whole app tree.
 * Catches any unhandled render/lifecycle error and shows ErrorPage.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorPage
          error={this.state.error}
          onReset={() => {
            this.reset();
            window.location.href = '/';
          }}
        />
      );
    }
    return this.props.children;
  }
}
