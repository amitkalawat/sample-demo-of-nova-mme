import React from 'react';
import './agentMain.css'
import { Badge, Button, ExpandableSection, Modal, Link, Tabs } from '@cloudscape-design/components';
import { getCurrentUser } from 'aws-amplify/auth';
import Loading from '../../static/waiting-texting.gif'
import MixedContentDisplay from './mixedContent';
import VideoPlayer from '../novaMme/videoPlayer';
import AudioPlayer from '../novaMme/audioPlayer';
import { FetchPost } from "../../resources/data-provider";
import {DecimalToTimestamp, clusterDataByDistance} from "../../resources/utility";

const SAMPLES = [];

class AgentMain extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            alert: null,
            items: null,
            userQuery: "",
            selectedItemId: null,
            currentUserName: null,
            refreshSearchTaskId: false,

            chatHistory: [],
            citations: [],
            loading: false,

            selectedClip: null,
            showSearchVideoModal: false,

            // Audio settings
            audioDuration: 30,

        };
        // Initialize client with config
        this.focusRef = React.createRef();
        this.chatAreaRef = React.createRef();

    }
    async componentDidMount() {
        if (this.state.currentUserName === null) {
            const { username } = await getCurrentUser();
            this.setState({currentUserName: username});
        }
    }

    componentDidUpdate(prevProps, prevState) {
        // Always scroll to the bottom when chat history changes or loading state changes
        if (prevState.chatHistory !== this.state.chatHistory || 
            prevState.loading !== this.state.loading) {
            this.scrollToBottom();
        }

        if (prevProps.cleanSelectionSignal !== this.props.cleanSelectionSignal) {
            this.setState({selectedItemId: null})
        }
    }

    scrollToBottom = () => {
        // Use both methods to ensure reliable scrolling
        if (this.focusRef.current) {
            this.focusRef.current.scrollIntoView({ behavior: "smooth" });
        }
        if (this.chatAreaRef.current) {
            this.chatAreaRef.current.scrollTop = this.chatAreaRef.current.scrollHeight;
        }
    }

    handleThumbnailClick = (taskId, autoPlay=false) => {
        this.setState({selectedItemId: taskId, autoPlay: autoPlay});
    }

    constructMessage(role, msg, citations) {
        msg = {
            "role": role,
            "content": [
                {
                    "text": msg,
                }
            ]
        }
        if (citations !== null && citations.length > 0) {
            msg.content[0]["citations"] = clusterDataByDistance(citations);
        }
        console.log(msg);
        return msg;
    }

    handleSubmit = async (e) => {
        try {
            var chatHistory = this.state.chatHistory;
            chatHistory.push(this.constructMessage("user", this.state.userQuery, null));

            this.setState({loading: true, userQuery:"", chatHistory: chatHistory}, ()=>{
                // Scroll to bottom after adding user message
                setTimeout(() => this.scrollToBottom(), 100);
                FetchPost("/nova/embedding/search-task-vector-chat", {
                    "ChatHistory": this.getChatHistoryWithoutCitations(),
                    "TopK": 3,
                    "AudioDuration": this.state.audioDuration,
                }, "NovaService").then((data) => {
                    var resp = data.body;
                    if (data.statusCode !== 200) {
                        this.setState( {status: null, alert: data.body});
                    }
                    else {
                        if (resp !== null) {
                            var chatHistory = this.state.chatHistory;
                            chatHistory.push(this.constructMessage("assistant", resp.reply, resp.citations));
                            this.setState({loading: false, chatHistory: chatHistory}, () => {
                                // Scroll to bottom after adding assistant message
                                setTimeout(() => this.scrollToBottom(), 100);
                            });
                        }
                    }
                })
                .catch((err) => {
                    this.setState( {status: null, alert: err.message});
                });                   
            });
           
        }
        catch (error) {
            console.log(error);
            
        }
    };

    getChatHistoryWithoutCitations() {
        var chatHistory = this.state.chatHistory;
        var filtered = chatHistory.map(m => {
            if (m.role === "assistant") {
                return this.constructMessage(m.role, m.content[0].text, null);
            }
            return m;
        });
        return [filtered.at(-1)];
    }

    handleCitationClick(citation) {
        if(citation?.Modality !== "text")
        this.setState({showSearchVideoModal: true, selectedClip: citation})
    }

    render() {
        return (
            <div className="agentmain">
                <div className='chatarea' ref={this.chatAreaRef}>
                    {this.state.chatHistory && this.state.chatHistory.map((c,i)=>{
                        return <div key={`msg_${i}`} className={`msg${c.role}`}>
                            {  c.role === "assistant"?<MixedContentDisplay content={c.content[0].text}></MixedContentDisplay>:c.content[0].text}
                            {c.content[0]?.citations && c.content[0]?.citations.map((cit, j)=>{
                                return <div key={`cit_${i}_${j}`} className='citation' onClick={()=>this.handleCitationClick(cit)}>
                                            &nbsp;[{cit.Modality}]
                                            <div className='distance'>
                                                <Badge color={cit.Category === "high"?"green":cit.Category === "medium"?"severity-medium":"grey"}>
                                                Distance: {cit.Distance.toFixed(3)}
                                                </Badge>
                                            </div>
                                            <div className='source'><Link href={cit.FileUrl} external={true} externalIconAriaLabel="(opens in a new tab)">Source</Link></div>
                                            {cit.Modality === "video" && 
                                                <div>
                                                    <VideoPlayer key={`${cit.TaskId}_${cit.StartSec}`} src={cit.FileUrl} startTime={cit.StartSec} controls={false}/>
                                                    <div className='time'>{DecimalToTimestamp(cit.StartSec)} - {DecimalToTimestamp(cit.EndSec)}</div>
                                                </div>}
                                            {cit.Modality === "audio" && 
                                                <div>
                                                    <AudioPlayer 
                                                        key={`${cit.TaskId}_${cit.StartSec}`} 
                                                        src={cit.FileUrl} 
                                                        startTime={cit.StartSec} 
                                                        endTime={cit.EndSec}
                                                        controls={true} 
                                                        autoPlay={false}
                                                        className="citaudio"
                                                        style={{width: '90%'}}/>
                                                    <div className='time'>{DecimalToTimestamp(cit.StartSec)} - {DecimalToTimestamp(cit.EndSec)}</div>
                                                </div>}
                                            {cit.Modality === "image" && <div>
                                                <img className="citimg" key={`${cit.TaskId}_${cit.StartSec}`} src={cit.FileUrl}/>
                                                </div>}
                                            {cit.Modality === "text" && <div className='cittxt' key={`text_${i}_${j}`}>
                                                    <ExpandableSection headerText={`${cit.TaskName} (${cit.TextIndex})`} variant="default">
                                                        <div className='time'>{cit.StartCharPosition} - {cit.EndCharPosition} characters</div>
                                                        {cit.TextCitation}
                                                    </ExpandableSection>
                                            </div>}
                                </div>
                            })}
                        </div>
                    })}
                    {this.state.loading && <div className='msgassistant'>
                        <img src={Loading}></img>
                    </div>}
                    <div className='chatbottom' ref={this.focusRef}></div>
                </div>
                <div className='input'>
                    <input
                        type="text"
                        className="input-text"
                        placeholder="Ask questions about your videos, images or text files..."
                        onChange={(e)=>{
                            const msg = e.target.value;
                            this.setState({userQuery: msg});
                        }}
                        onKeyDown={(e)=>{
                                if(e.key === "Enter")this.handleSubmit(e);
                            }}
                        value={this.state.userQuery}
                    />
                    <div className='submit'>
                    <Button variant='primary' iconName="arrow-up" 
                        disabled={this.state.userQuery.length === 0}
                        onClick={(e) =>{
                            this.handleSubmit(e);
                        }
                    }></Button>
                </div>
                </div>
                <div className='samples'>
                    <div className='container'>
                        {SAMPLES.map((s,i)=>{
                            return <div key={`sample_${i}`} className='item' onClick={()=> {
                                this.setState({userQuery: s}, () => {this.handleSubmit(null)});}
                            }>{s}</div>;
                        })}
                    </div>
                </div>
                <Modal
                    onDismiss={() => this.setState({showSearchVideoModal: false})}
                    visible={this.state.showSearchVideoModal}
                    header={`Search Result`}
                    size='large'
                >
                    <div className='videosearchresultpreview'>
                    {this.state.selectedClip?.Modality === "video" && <div className='videomdoal'>
                        <VideoPlayer 
                            src={this.state.selectedClip.FileUrl} 
                            startTime={this.state.selectedClip.StartSec} 
                            endTime={this.state.selectedClip.EndSec} 
                            controls={true} 
                            autoPlay={true} 
                            className="videom"/>
                        <div className="timestamp">{DecimalToTimestamp(this.state.selectedClip.StartSec)} - {DecimalToTimestamp(this.state.selectedClip.EndSec)} s</div>
                        <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                        <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                    </div>}
                    {this.state.selectedClip?.Modality === "audio" && <div className='videomdoal'>
                        <AudioPlayer 
                            src={this.state.selectedClip.FileUrl} 
                            startTime={this.state.selectedClip.StartSec} 
                            endTime={this.state.selectedClip.EndSec} 
                            controls={true} 
                            autoPlay={true} 
                            className="audiom"
                            style={{width: '100%', marginBottom: '10px'}}/>
                        <div className="timestamp">{DecimalToTimestamp(this.state.selectedClip.StartSec)} - {DecimalToTimestamp(this.state.selectedClip.EndSec)} s</div>
                        <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                        <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                    </div>}
                    {this.state.selectedClip?.Modality === "image" && <div className='videomdoal'>
                        <img src={this.state.selectedClip?.FileUrl}/>
                        <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                        <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                    </div>}
                    {this.state.selectedClip?.Modality === "text" && <div className='videomdoal'>
                        <div className="desc">{this.state.selectedClip?.Citation}</div>
                        <br/>
                        <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                        <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                    </div>}
                    </div>
                    
                </Modal>
            </div>
        );
    }
}

export default AgentMain;