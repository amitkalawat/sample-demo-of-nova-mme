import React, { Component, createRef } from 'react';
import VideoPlayer from './videoPlayer';

class LazyVideoPlayer extends Component {
  constructor(props) {
    super(props);
    this.containerRef = createRef();
    this.state = {
      isVisible: false,
      hasLoaded: false
    };
  }

  componentDidMount() {
    // Create Intersection Observer for lazy loading
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this.state.hasLoaded) {
            this.setState({ isVisible: true, hasLoaded: true });
            // Once loaded, we can disconnect the observer
            this.observer.disconnect();
          }
        });
      },
      {
        root: null,
        rootMargin: '200px', // Load videos 200px before they enter viewport
        threshold: 0.01
      }
    );

    if (this.containerRef.current) {
      this.observer.observe(this.containerRef.current);
    }
  }

  componentWillUnmount() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  render() {
    const { placeholder, ...videoProps } = this.props;
    const { isVisible } = this.state;

    return (
      <div ref={this.containerRef} style={{ width: '100%', height: '100%' }}>
        {isVisible ? (
          <VideoPlayer {...videoProps} />
        ) : (
          placeholder || <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '150px'
          }}>
            <span style={{ color: '#666' }}>Loading...</span>
          </div>
        )}
      </div>
    );
  }
}

export default LazyVideoPlayer;
