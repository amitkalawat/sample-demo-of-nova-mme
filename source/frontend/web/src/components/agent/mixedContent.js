import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import './mixedContent.css'; // Import the custom CSS file

class MixedContentDisplay extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      displayedContent: '', // Initialize as empty string
    };
    this.currentWordIndex = 0;
    this.intervalId = null;
  }

  componentDidMount() {
    this.startDisplayingWords();
  }

  componentWillUnmount() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  startDisplayingWords() {
    let { content } = this.props;

    if (!content || typeof content !== 'string') return;

    // Remove surrounding quotes if present
    if (content.startsWith('"') && content.endsWith('"')) {
      content = content.replace(/^"|"$/g, '');
    }

    // Split content into words (handle spaces, newlines, etc.)
    const words = content.replace(/\\n/g, ' ').split(/\s+/).filter(Boolean);
    this.currentWordIndex = 0;

    this.intervalId = setInterval(() => {
      if (this.currentWordIndex >= words.length) {
        clearInterval(this.intervalId);
        return;
      }

      const nextWord = words[this.currentWordIndex] || '';

      this.setState((prevState) => ({
        displayedContent: prevState.displayedContent
          ? `${prevState.displayedContent} ${nextWord}`
          : nextWord,
      }));

      this.currentWordIndex += 1;
    }, 50); // 100ms delay between words
  }

  render() {
    const { displayedContent } = this.state;

    if (!displayedContent) {
      return null;
    }

    return (
      <div className="mixed-content-container">
        <ReactMarkdown rehypePlugins={[rehypeRaw]}>
          {displayedContent}
        </ReactMarkdown>
      </div>
    );
  }
}

export default MixedContentDisplay;
