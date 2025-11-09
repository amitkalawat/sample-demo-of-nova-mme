import React from 'react';
import './about.css';
import { Tabs, Container, Header, SpaceBetween, Box, ColumnLayout, Badge } from '@cloudscape-design/components';
import Diagram from './static/mme-diagram.png';
import Architecture from './static/nova-mme-architecture.png';

class About extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            activeTabId: "overview"
        };
    }

    render() {
        return (
            <div className="about-page">
                  <Tabs
                      activeTabId={this.state.activeTabId}
                      onChange={({ detail }) => this.setState({ activeTabId: detail.activeTabId })}
                      tabs={[
                          {
                              label: "Overview",
                              id: "overview",
                              content: (
                                  <SpaceBetween size="l">
                                      <Box variant="h2">Amazon Nova Multi-Modal Embedding (MME)</Box>
                                      <a href='https://aws.amazon.com/blogs/aws/amazon-nova-multimodal-embeddings-now-available-in-amazon-bedrock/' target='blank'>Amazon Nova Multimodal Embeddings</a>
                                  </SpaceBetween>
                              )
                          },
                          {
                              label: "Multi-Modal Embedding",
                              id: "diagram",
                              content: (
                                  <SpaceBetween size="l">
                                      <Box variant="h2">Multi-Modal Embedding Process</Box>
                                      <Box>
                                          Understanding how Nova MME processes different types of content to create searchable embeddings.
                                      </Box>

                                      <div className="embedding-diagram">
                                          <img src={Diagram} alt="Multi-Modal Embedding Diagram" style={{width: '100%', maxWidth: '800px'}} />
                                      </div>

                                      
                                  </SpaceBetween>
                              )
                          },
                          {
                              label: "Architecture",
                              id: "architecture",
                              content: (
                                  <SpaceBetween size="l">
                                      <Box variant="h2">System Architecture</Box>
                                      <Box>
                                          Nova MME is built on a modern serverless architecture using AWS services for scalability, reliability, and performance.
                                      </Box>
                                      
                                      <div className="architecture-diagram">
                                          <img src={Architecture} alt="Nova MME Architecture" style={{width: '100%', maxWidth: '800px'}} />
                                      </div>

                                      <ColumnLayout columns={2}>
                                          <div>
                                              <Box variant="h3">Core Components</Box>
                                              <ul>
                                                  <li><strong>Frontend:</strong> React-based web application</li>
                                                  <li><strong>API Gateway:</strong> RESTful API endpoints</li>
                                                  <li><strong>Lambda Functions:</strong> Serverless compute for processing</li>
                                                  <li><strong>S3 Storage:</strong> Media file storage and management</li>
                                                  <li><strong>S3 Vectors:</strong> Serverless vector storage</li>
                                              </ul>
                                          </div>
                                          <div>
                                              <Box variant="h3">AI/ML Services</Box>
                                              <ul>
                                                  <li><strong>Amazon Nova:</strong> Multi-modal embedding generation</li>
                                                  <li><strong>Bedrock:</strong> Foundation model access</li>
                                              </ul>
                                          </div>
                                      </ColumnLayout>
                                  </SpaceBetween>
                              )
                          }
                      ]}
                  />
            </div>
        );
    }
}

export default About;