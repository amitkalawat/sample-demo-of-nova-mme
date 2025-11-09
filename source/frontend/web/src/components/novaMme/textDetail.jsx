import React, { Component } from "react";
import './textDetail.css';
/**
 * Props:
 *  - url?: string            // optional: a public or presigned URL to a .txt file
 *  - filename?: string       // optional: display name
 *  - maxChars?: number       // optional: truncate content after this many chars (default: 200000)
 *
 * Usage examples:
 *  <TextFileViewer url="https://bucket.s3.amazonaws.com/path/file.txt" filename="README.txt" />
 *  <TextFileViewer />   // will show file input for local upload
 */
class TextDetail extends Component {
  static defaultProps = {
    maxChars: 200000,
  };

  constructor(props) {
    super(props);
    this.state = {
      loading: false,
      error: null,
      content: null,
      filename: props.filename || null,
    };
    this.fileInputRef = React.createRef();
  }

  componentDidMount() {
    if (this.props.task?.FileUrl) {
      this.loadFromUrl(this.props.task.FileUrl);
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.task?.FileUrl && this.props.task !== prevProps.task) {
      this.loadFromUrl(this.props.task.FileUrl);
    }
  }

  loadFromUrl = async (url) => {
    this.setState({ loading: true, error: null, content: null, filename: this.props.filename || this.extractNameFromUrl(url) });
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch file: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      this.setState({ content: this.truncateIfNeeded(text), loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  };

  extractNameFromUrl(url) {
    try {
      const parts = url.split("?")[0].split("/");
      return parts[parts.length - 1] || url;
    } catch {
      return url;
    }
  }

  truncateIfNeeded(text) {
    const { maxChars } = this.props;
    if (maxChars && text.length > maxChars) {
      return text.slice(0, maxChars) + `\n\n... (truncated, showing first ${maxChars} chars)`;
    }
    return text;
  }

  onLocalFileSelected = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      this.setState({ error: "Only .txt files are supported.", content: null, filename: null });
      return;
    }

    this.setState({ loading: true, error: null, content: null, filename: file.name });

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      this.setState({ content: this.truncateIfNeeded(text), loading: false });
    };
    reader.onerror = () => {
      this.setState({ error: "Failed to read file.", loading: false });
    };
    reader.readAsText(file, "utf-8");
  };

  clear = () => {
    this.setState({ content: null, error: null, loading: false, filename: null });
    if (this.fileInputRef.current) this.fileInputRef.current.value = "";
  };

  render() {
    const { loading, error, content, filename } = this.state;
    const containerStyle = {
      border: "1px solid #e0e0e0",
      borderRadius: 8,
      padding: 12,
      background: "#fff",
      maxWidth: "100%",
    };
    const headerStyle = {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
      gap: 12,
      flexWrap: "wrap",
    };
    const filenameStyle = { fontSize: 14, fontWeight: 600 };
    const controlsStyle = { display: "flex", gap: 8, alignItems: "center" };
    const preStyle = {
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "auto",
      maxHeight: "60vh",
      padding: 12,
      background: "#fafafa",
      borderRadius: 6,
      border: "1px solid #eee",
    };
    const smallNote = { fontSize: 12, color: "#666" };

    return (
      <div className="novammetxtdetail" style={containerStyle}>
        <b>
            {this.props.task?.Request?.TaskName}

        </b>

        {loading && <div style={smallNote}>Loading...</div>}
        {error && <div style={{ color: "crimson", marginBottom: 8 }}>{error}</div>}

        {content ? (
          <pre style={preStyle} tabIndex={0} aria-label="Text file content">
            {content}
          </pre>
        ) : (
          !loading && !error && <div style={smallNote}>No content to display.</div>
        )}
      </div>
    );
  }
}

export default TextDetail;
