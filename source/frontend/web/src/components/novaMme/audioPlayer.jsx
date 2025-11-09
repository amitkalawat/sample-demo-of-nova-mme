import React, { Component, createRef } from 'react';

/**
 * AudioPlayer Component
 * 
 * Props:
 * - src: Audio source URL (required)
 * - startTime: Time in seconds to start playback (optional)
 * - endTime: Time in seconds to stop playback (optional)
 * - controls: Show audio controls (default: true)
 * - autoPlay: Auto-play audio (default: false)
 * - className: CSS class name (default: "audio")
 * - preload: Preload behavior (default: "metadata")
 * - style: Inline styles (optional)
 */
class AudioPlayer extends Component {
  constructor(props) {
    super(props);
    this.audioRef = createRef();
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
  }

  componentDidMount() {
    const audio = this.audioRef.current;
    const { startTime, autoPlay } = this.props;

    // Wait for metadata to load before seeking to startTime
    audio.addEventListener('loadedmetadata', () => {
      if (startTime != null && startTime < audio.duration) {
        audio.currentTime = startTime;
        // If autoPlay is enabled, start playing after seeking
        if (autoPlay) {
          audio.play().catch(e => console.log('Auto-play prevented:', e));
        }
      }
    });

    // Listen for time updates to stop at endTime
    audio.addEventListener('timeupdate', this.handleTimeUpdate);

    // Handle cases where metadata is already loaded
    if (audio.readyState >= 1) {
      if (startTime != null && startTime < audio.duration) {
        audio.currentTime = startTime;
        if (autoPlay) {
          audio.play().catch(e => console.log('Auto-play prevented:', e));
        }
      }
    }
  }

  componentDidUpdate(prevProps) {
    const audio = this.audioRef.current;
    const { src, startTime, autoPlay } = this.props;

    // Handle source changes
    if (prevProps.src !== src) {
      audio.load();
      // After loading new source, wait for metadata and set startTime
      audio.addEventListener('loadedmetadata', () => {
        if (startTime != null && startTime < audio.duration) {
          audio.currentTime = startTime;
          if (autoPlay) {
            audio.play().catch(e => console.log('Auto-play prevented:', e));
          }
        }
      }, { once: true });
    }

    // Handle startTime changes
    if (prevProps.startTime !== startTime && startTime != null) {
      if (audio.readyState >= 1) {
        audio.currentTime = startTime;
        if (autoPlay && audio.paused) {
          audio.play().catch(e => console.log('Auto-play prevented:', e));
        }
      }
    }

    // Handle autoPlay changes
    if (prevProps.autoPlay !== autoPlay && autoPlay && audio.paused) {
      audio.play().catch(e => console.log('Auto-play prevented:', e));
    }
  }

  componentWillUnmount() {
    const audio = this.audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeEventListener('timeupdate', this.handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    }
  }

  handleTimeUpdate() {
    const { endTime } = this.props;
    const audio = this.audioRef.current;

    if (endTime != null && audio.currentTime >= endTime) {
      audio.pause();
      // Optional: Reset to start time when reaching end time
      // audio.currentTime = this.props.startTime || 0;
    }
  }

  render() {
    const {
      src,
      controls = true,
      autoPlay = false,
      className = "audio",
      style = {}
    } = this.props;

    if (!src) {
      console.warn('AudioPlayer: No src provided');
      return <div style={{ color: 'red', padding: '10px' }}>No audio source provided</div>;
    }

    // Determine the audio format from the src URL
    const getAudioType = (url) => {
      if (!url) return null;
      const extension = url.split('.').pop().toLowerCase().split('?')[0];
      switch (extension) {
        case 'mp3':
          return 'audio/mpeg';
        case 'wav':
          return 'audio/wav';
        case 'ogg':
          return 'audio/ogg';
        case 'm4a':
          return 'audio/mp4';
        default:
          return 'audio/mpeg'; // Default to mp3
      }
    };

    const audioType = getAudioType(src);

    return (
      <div className={className}>
        <audio
          ref={this.audioRef}
          controls={controls}
          autoPlay={false} // We handle autoPlay manually to ensure startTime is set first
          style={{ width: '100%', minHeight: '54px', display: 'block' }}
          preload="metadata"
        >
          <source src={src} type={audioType} />
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }
}

export default AudioPlayer;