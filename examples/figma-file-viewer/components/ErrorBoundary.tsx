"use client";

import React, { Component, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error("FigmaRenderer Error:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: "20px",
            border: "1px solid #ff6b6b",
            borderRadius: "8px",
            backgroundColor: "#fff5f5",
            color: "#c92a2a",
            fontFamily: "system-ui, sans-serif",
          }}
          role="alert"
          aria-live="assertive"
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: "16px" }}>
            Rendering Error
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
            An error occurred while rendering this Figma design.
          </p>
          {this.state.error && (
            <details style={{ marginBottom: "12px" }}>
              <summary
                style={{ cursor: "pointer", fontSize: "13px", color: "#666" }}
              >
                Error Details
              </summary>
              <pre
                style={{
                  marginTop: "8px",
                  padding: "10px",
                  backgroundColor: "#f8f9fa",
                  borderRadius: "4px",
                  fontSize: "12px",
                  overflow: "auto",
                  maxHeight: "200px",
                }}
              >
                {this.state.error.message}
                {this.state.errorInfo?.componentStack && (
                  <>
                    {"\n\nComponent Stack:"}
                    {this.state.errorInfo.componentStack}
                  </>
                )}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleRetry}
            style={{
              padding: "8px 16px",
              backgroundColor: "#228be6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
            aria-label="Retry rendering the Figma design"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
