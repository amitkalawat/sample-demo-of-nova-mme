import React, { Component } from 'react';
import { FormField, Input, Select, Container, ColumnLayout, Header, RadioGroup } from '@cloudscape-design/components';

class EmbeddingSetting extends Component {

  constructor(props) {
    super(props);
    this.state = {
      request: null,
      mmEmbedModel: "amazon.nova-2-multimodal-embeddings-v1:0",

      // video specific
      embedMode: "AUDIO_VIDEO_COMBINED",
      duractionS: 5,

      // auido specific
      audioDurationS: 30,

      // image specific
      detailLevel: "STANDARD_IMAGE", // "DOCUMENT_IMAGE" for text-heavy images

      // text specific
      truncateMode: "END", //"START", "NONE"
      maxLengthChars: 800,
    }
  }

  getRequest() {
    switch (this.props.modality) {
      case "video":
        return {
          ModelId: this.state.mmEmbedModel,
          EmbedMode: this.state.embedMode,
          DurationS: this.state.duractionS < 1 || this.state.duractionS > 30 ? 5 : parseInt(this.state.duractionS)
        };
      case "audio":
        return {
          ModelId: this.state.mmEmbedModel,
          DurationS: this.state.audioDurationS < 1 || this.state.audioDurationS > 30 ? 30 : parseInt(this.state.audioDurationS)
        };
      case "image":
        return {
          ModelId: this.state.mmEmbedModel,
          DetailLevel: this.state.detailLevel
        };
      case "text":
        return {
          ModelId: this.state.mmEmbedModel,
          TruncateMode: this.state.truncateMode,
          MaxLengthChars: this.state.maxLengthChars < 1 || this.state.maxLengthChars > 800 ? 800 : parseInt(this.state.maxLengthChars)
        };
    }
    return null

  }

  render() {
    return <div className="embedding">
      <Container header={<Header variant='h3'>Multi-modal Embedding Setting: {this.props.modality}</Header>}>
        {this.props.modality === "video" &&
          <ColumnLayout columns={2}>
            <FormField label="Embedding Mode">
              <RadioGroup
                onChange={({ detail }) => this.setState({ embedMode: detail.value })}
                value={this.state.embedMode}
                items={[
                  { value: "AUDIO_VIDEO_COMBINED", label: "Audio video combined", description: "Will produce a single embedding combing both audible and visual content." },
                  { value: "AUDIO_VIDEO_SEPARATE", label: "Audio video seperated", description: "Will produce a two embeddings, one for the audible content and one for the visual content." },
                ]}
              />
            </FormField>
            <FormField label="Duration (in second)">
              <Input
                onChange={({ detail }) => {
                  this.setState({
                    duractionS: detail.value
                  });
                }}
                value={parseFloat(this.state.duractionS)}
                inputMode="numeric"
                type="number"
                invalid={this.state.duractionS < 1 || this.state.duractionS > 30}
              />
              {(this.state.duractionS < 1 || this.state.duractionS > 30) &&
                <div style={{ color: "red", padding: "5px" }}>Please choose a number between 1 and 30</div>}
            </FormField>
          </ColumnLayout>}
        {this.props.modality === "audio" &&
          <ColumnLayout columns={2}>
            <FormField label="Duration (in second)">
              <Input
                onChange={({ detail }) => {
                  this.setState({
                    duractionS: detail.value
                  });
                }}
                value={parseFloat(this.state.audioDurationS)}
                inputMode="numeric"
                type="number"
                invalid={this.state.audioDurationS < 1 || this.state.audioDurationS > 30}
              />
              {(this.state.audioDurationS < 1 || this.state.audioDurationS > 30) &&
                <div style={{ color: "red", padding: "5px" }}>Please choose a number between 1 and 30</div>}
            </FormField>
          </ColumnLayout>}
        {this.props.modality === "image" &&
          <ColumnLayout columns={2}>
            <FormField label="Image Detail Level">
              <RadioGroup
                onChange={({ detail }) => this.setState({ detailLevel: detail.value })}
                value={this.state.detailLevel}
                items={[
                  { value: "STANDARD_IMAGE", label: "Standard Image", description: "Optimized for photos and natural images (default)." },
                  { value: "DOCUMENT_IMAGE", label: "Document Image", description: "Optimized for text-heavy images like documents, charts, and diagrams. Provides higher resolution processing." },
                ]}
              />
            </FormField>
          </ColumnLayout>}
        {this.props.modality === "text" &&
          <ColumnLayout columns={2}>
            <FormField label="Truncation Mode">
              <RadioGroup
                onChange={({ detail }) => this.setState({ truncateMode: detail.value })}
                value={this.state.truncateMode}
                items={[
                  { value: "START", label: "Start ", description: "Omit characters from the start of the text when necessary." },
                  { value: "END", label: "End", description: "Omit characters from the end of the text when necessary." },
                  { value: "NONE", label: "None", description: "Fail if text length exceeds the model’s maximum token limit." },
                ]}
              />
            </FormField>
            <FormField label="Max Length Chars (Optional)" description="The maximum length to allow for each segment. The model will attempt to segment only at word boundaries.">
              <Input
                onChange={({ detail }) => {
                  this.setState({
                    maxLengthChars: detail.value
                  });
                }}
                value={parseFloat(this.state.maxLengthChars)}
                inputMode="numeric"
                type="number"
                invalid={this.state.maxLengthChars !== null && (this.state.maxLengthChars < 800 || this.state.maxLengthChars > 8192)}
              />
              {(this.state.maxLengthChars < 800 || this.state.maxLengthChars > 8192) &&
                <div style={{ color: "red", padding: "5px" }}>Please choose a number between 800 and 8192</div>}
            </FormField>
          </ColumnLayout>}
      </Container>
    </div>
  };
};
export default EmbeddingSetting;