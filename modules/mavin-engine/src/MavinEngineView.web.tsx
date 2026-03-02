// modules/mavin-engine/src/MavinEngineView.web.ts
import * as React from 'react';
import { MavinEngineViewProps } from './MavinEngine.types';

/**
 * Web implementation of MavinEngineView
 * Renders an iframe for web platform
 */
export default function MavinEngineView(props: MavinEngineViewProps) {
  const { url, onLoad, onError, style } = props;
  
  const [isLoading, setIsLoading] = React.useState(true);
  const [hasError, setHasError] = React.useState(false);

  const handleLoad = React.useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    setIsLoading(false);
    setHasError(false);
    if (onLoad) {
      onLoad({ 
        nativeEvent: { 
          url: url || '' 
        } 
      });
    }
  }, [url, onLoad]);

  const handleError = React.useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    if (onError) {
      onError({ 
        nativeEvent: { 
          error: 'Failed to load content' 
        } 
      });
    }
  }, [onError]);

  if (!url) {
    return (
      <div style={styles.emptyContainer}>
        <p style={styles.emptyText}>No URL provided</p>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, ...style }}>
      {isLoading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading...</p>
        </div>
      )}
      
      {hasError && (
        <div style={styles.errorOverlay}>
          <p style={styles.errorText}>Failed to load content</p>
        </div>
      )}
      
      <iframe
        src={url}
        style={{
          ...styles.iframe,
          opacity: isLoading || hasError ? 0.5 : 1,
        }}
        onLoad={handleLoad}
        onError={handleError}
        allow="autoplay; encrypted-media"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        title="MavinEngine View"
      />
    </div>
  );
}

// Styles object
const styles = {
  container: {
    position: 'relative' as const,
    width: '100%',
    height: '100%',
    minHeight: 200,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    transition: 'opacity 0.3s ease',
  },
  loadingOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #f3f3f3',
    borderTop: '3px solid #D4AF37',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: 10,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
    margin: 0,
  },
  errorOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    display: 'flex' as const,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  errorText: {
    color: '#d32f2f',
    fontSize: 14,
    fontWeight: '500' as const,
    backgroundColor: 'white',
    padding: '8px 16px',
    borderRadius: 4,
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  emptyContainer: {
    width: '100%',
    height: '100%',
    minHeight: 200,
    display: 'flex' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic' as const,
  },
};

// Add global keyframes for spinner animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}