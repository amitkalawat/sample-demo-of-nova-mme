import React, { createRef } from 'react';
import './videoSearch.css'
import { Button, Link, FileInput, Alert, Spinner, Icon, Modal, Box, SpaceBetween, Badge, ButtonDropdown, Tabs, Container } from '@cloudscape-design/components';
import { FetchPost } from "../../resources/data-provider";
import DefaultThumbnail from '../../static/default_thumbnail.png';
import { getCurrentUser } from 'aws-amplify/auth';
import VideoUpload from './videoUpload';
import VideoPlayer from './videoPlayer';
import LazyVideoPlayer from './lazyVideoPlayer';
import AudioPlayer from './audioPlayer';
import { DecimalToTimestamp, clusterDataByDistance, FormatSeconds } from "../../resources/utility"
import BroomIcon from "../../static/broom_button_icon.svg"
import TextIcon from "../../static/textlogo.jpg"
import AudioIcon from "../../static/audio-icon.png"
import TextDetail from './textDetail'
// Import will be replaced with fetch from public folder
import KeywordSearch from './keywordSearch';

class VideoSearch extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            status: "loading", // null, loading, loaded
            alert: null,
            filterText: "",
            uploadFile: [],
            items: [],
            embedSearchItems: [],
            selectedItemId: null,
            pageSize: 9,
            mmScoreThreshold: 1.52,
            textScoreThreshold: 1.003,
            videoActiveTabId: "mmembed",
            selectedClip: null,
            uploadedFile: [],

            inputBytes: null,

            currentSearchTabId: "embedding",

            showDeleteConfirmModal: false,
            showFrame: [],
            showSampleImages: false,
            showSearchVideoModal: false,
            showInputBytesPreviewModeal: false,

            selectedSearchOptionId: "all",

            textScoreExpanded: false,
            imageScoreExpanded: false,
            showUploadModal: false,
            tempImages: []
        };

        this.showMoreNumber = 6;
        this.searchTimer = null;
        this.searchOptions = [
            { text: "Keyword search", id: "text" },
            { text: "Semantic search", id: "text_embedding" },
            { text: "Multimodal search", id: "mm_embedding" },
        ];
    }

    handleTaskClick = (task, autoPlay) => {
        //console.log(autoPlay);
        //this.props.onThumbnailClick(taskId, autoPlay);
        this.setState({ selectedFile: task, showFileDetailModal: true });
    }

    handleSearchFileClick = (clip) => {
        this.setState({
            selectedClip: null
        }, () => {
            this.setState({
                showSearchVideoModal: true,
                selectedClip: clip
            });
        });

    }

    async componentDidMount() {
        // Fetch temp images from public folder
        try {
            const response = await fetch('/temp/temp-images.json');
            const data = await response.json();
            this.setState({ tempImages: data.images });

            if (this.state.items === null || this.state.items.length === 0) {
                // Load temp images initially
                this.setState({
                    items: data.images,
                    status: "loaded"
                });
                // Also populate regular items if needed
                this.populateItems();
            }
        } catch (error) {
            console.error('Error loading temp images:', error);
            this.populateItems();
        }
    }

    componentDidUpdate(prevProps) {
        if (prevProps.refreshSearchTaskId !== this.props.refreshSearchTaskId) {
            this.populateItems();
        }
    }

    calculateTimeDelta(timestamp1, timestamp2) {
        // Parse the timestamps into Date objects
        const date1 = new Date(timestamp1);
        const date2 = new Date(timestamp2);

        // Calculate the time difference in milliseconds
        const deltaMilliseconds = date2 - date1;

        // Return the time difference in milliseconds
        return FormatSeconds(deltaMilliseconds / 1000)
    }
    populateItems() {
        this.setState({ status: "loading", embedSearchItems: [], items: [], selectedClip: null });
        if (!this.state.filterText && !this.state.inputBytes)
            this.searchAll();
        else {
            this.searchEmbedding();
        }

    }

    populateKeywordItems() {
        const searchText = this.state.filterText.toLowerCase().trim();

        if (!searchText) {
            // If no search text, show all images
            this.setState({
                items: this.state.tempImages,
                status: "loaded"
            });
            return;
        }

        // Search through images by name and keywords
        const filteredItems = this.state.tempImages.filter(image => {
            // Search in filename (without extension)
            const nameMatch = image.name.toLowerCase().includes(searchText);

            // Search in keywords array
            const keywordMatch = image.keywords.some(keyword =>
                keyword.toLowerCase().includes(searchText)
            );

            return nameMatch || keywordMatch;
        });

        // Update state with filtered results
        this.setState({
            embedSearchItems: filteredItems,
            status: filteredItems.length > 0 ? "loaded" : null
        });

        // Log search results for debugging
        console.log(`Search for "${searchText}" found ${filteredItems.length} results:`, filteredItems);
    }

    clearSearch() {
        this.setState({
            filterText: "",
            items: this.state.tempImages,
            status: "loaded"
        });
    }

    searchAll() {
        const { username } = getCurrentUser().then((username) => {
            FetchPost("/nova/embedding/search-task", {
                "SearchText": this.state.filterText,
                "RequestBy": username.username,
                "PageSize": this.state.pageSize,
                "FromIndex": 0,
                "TaskType": "tlabsmmembed"
            }, "NovaService").then((data) => {
                var resp = data.body;
                if (data.statusCode !== 200) {
                    this.setState({ status: null, alert: data.body });
                }
                else {
                    if (resp !== null) {
                        var items = resp;
                        //console.log(items);
                        this.setState(
                            {
                                items: items === null ? [] : items,
                                status: null,
                                alert: null,
                            }
                        );
                    }
                }
            })
                .catch((err) => {
                    this.setState({ status: null, alert: err.message });
                });
        }

        )
    }
    searchEmbedding() {
        const { username } = getCurrentUser().then((username) => {
            FetchPost("/nova/embedding/search-task-vector", {
                "SearchText": this.state.filterText,
                "Source": "",
                "InputType": this.state.inputBytes ? "image" : "text", // image, video, audio
                "InputBytes": this.state.inputBytes === null ? null : this.state.inputBytes.split("base64,")[1],
                "InputFormat": this.state.inputBytes === null ? null : this.state.inputBytes.split("base64,")[0].split("/")[1].replace(";", ""),
                "RequestBy": username.username,
                "PageSize": this.state.pageSize,
                "FromIndex": 0,
                "InputType": this.state.inputBytes ? "image" : "text",
                "EmbeddingOptions": this.state.selectedSearchOptionId === "all" ? null : [this.state.selectedSearchOptionId],
                "InputFormat": this.state.uploadedFile && this.state.uploadedFile.length > 0 ? this.state.uploadedFile[0].type.split("/")[1] : ""
            }, "NovaService").then((data) => {
                var resp = data.body;
                if (data.statusCode !== 200) {
                    this.setState({ status: null, alert: data.body });
                }
                else {
                    if (resp !== null) {
                        var items = resp;
                        //console.log(items);
                        this.setState(
                            {
                                items: [],
                                embedSearchItems: items === null ? [] : clusterDataByDistance(items),
                                status: null,
                                alert: null,
                            }
                        );
                    }
                }
            })
                .catch((err) => {
                    this.setState({ status: null, alert: err.message });
                });
        }

        )
    }

    handleDelete = e => {
        if (this.state.selectedItemId === null) return;

        this.setState({ status: "loading" });
        FetchPost("/nova/embedding/delete-task", {
            "TaskId": this.state.selectedItemId
        }, "NovaService").then((data) => {
            var resp = data.body;
            if (data.statusCode !== 200) {
                this.setState({ status: null, alert: data.body, showDeleteConfirmModal: false });
            }
            else {
                if (resp !== null) {
                    //console.log(resp);
                    this.setState(
                        {
                            status: null,
                            alert: null,
                            items: this.state.items.filter(item => item.TaskId !== this.state.selectedItemId),
                            selectedItemId: null,
                            showDeleteConfirmModal: false
                        }
                    );
                }
            }
        })
            .catch((err) => {
                this.setState({ status: null, alert: err.message, showDeleteConfirmModal: false });
            });
    }

    handleImageChange = (files) => {
        const file = files[0];

        if (file) {
            const reader = new FileReader();

            //const base64Str = reader.result;
            reader.onloadend = () => {
                this.setState({
                    inputBytes: reader.result,
                });
            };

            reader.readAsDataURL(file);
        }
    };

    handleSampleSelect = e => {
        this.setState({
            showSampleImages: false,
            inputBytes: e.detail.selectedItems[0].image_bytes,
            status: null
        });

    }
    handleVideoUpload = () => {
        this.setState({ showUploadModal: false, refreshSearchTaskId: Math.random().toString() });
        this.populateItems();
    }

    getThumbnail(l) {
        if (l.Modality === "text")
            return <img className='icon' src={TextIcon} key={`txt_${l.TaskId}`} onClick={({ detail }) => { this.handleTaskClick(l, false); }} />
        else if (l.Modality === "audio")
            return <img className='icon' src={AudioIcon} key={`txt_${l.TaskId}`} onClick={({ detail }) => { this.handleTaskClick(l, false); }} />
        else if (l.Modality === "video" && l.ThumbnailUrl)
            return <img key={crypto.randomUUID()} className='thumbnail' src={l.ThumbnailUrl} alt={l.FileName} onClick={({ detail }) => { this.handleTaskClick(l, false); }}></img>
        else if (l.Modality === "image" && l.FileUrl)
            return <img key={crypto.randomUUID()} className='thumbnail' src={l.FileUrl} alt="Generating thumbnail" onClick={({ detail }) => { this.handleTaskClick(l, false); }}></img>
        else
            return <img key="default-icon" className='thumbnail' src={DefaultThumbnail} alt="Default thumbnail" onClick={({ detail }) => { this.handleTaskClick(l, false); }} />
    }

    render() {
        return (
            <div className="mmevideosearch">
                {this.state.alert !== undefined && this.state.alert !== null && this.state.alert.length > 0 ?
                    <Alert statusIconAriaLabel="Warning" type="warning">
                        {this.state.alert}
                    </Alert> : <div />}
                <div className='globalaction'>
                    {this.props.readonlyMode !== true ?
                        <div className='upload'><Button onClick={() => this.setState({ showUploadModal: true })} variant="primary">
                            <Icon name="upload" />&nbsp;
                            Upload a file
                        </Button></div>
                        : <div className='readonly-note'>Upload is currently disabled for this user</div>}
                    <div />
                </div>
                <div className='searchinput'>
                    <div className='input'>

                        {this.state.inputBytes !== null ?
                            <div className='previewupload' onClick={() => this.setState({ showInputBytesPreviewModeal: true })}>
                                <img src={this.state.inputBytes}></img>
                            </div>
                            : <input
                                type="text"
                                className="input-text"
                                placeholder="Search"
                                onChange={(e) => this.setState({ filterText: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") this.populateItems() }}
                                value={this.state.filterText}
                            />
                        }
                    </div>
                    <div className='clear'>
                        {(this.state.filterText || this.state.inputBytes) && <Link onClick={() => { { this.setState({ filterText: "", inputBytes: null, clipItems: [], selectedSearchOptionId: "all" }, () => this.populateItems()); } }}>
                            <Icon name="close" />
                        </Link>}
                    </div>
                    <div className='search'>
                        <Button variant='primary' onClick={() => this.populateItems()}><Icon name="search" /></Button>&nbsp;
                    </div>
                    <div className='upload'>
                        <FileInput accept='.png,.jpeg,.gif,.webp'
                            onChange={({ detail }) => {
                                this.setState({ uploadedFile: detail.value });
                                this.handleImageChange(detail.value);
                            }}
                            value={this.state.uploadedFile}
                        >
                            Image Search
                        </FileInput>
                    </div>
                    <div className='setting'>
                        <ButtonDropdown selectedItemId={this.state.selectedSearchOptionId} onItemClick={({ detail }) => {
                            console.log(detail);
                            this.setState({ selectedSearchOptionId: detail.id });
                        }}
                            items={[
                                { text: "All", id: "all", checked: true, },
                                { text: "Image", id: "image", checked: true, },
                                { text: "Text", id: "text", checked: true, },
                                { text: "Audio-video", id: "audio-video" },
                                { text: "Video", id: "video", checked: true },
                                { text: "Audio", id: "audio", checked: true },
                            ]}
                        >
                            <Icon name="settings" />&nbsp;Search Option: {this.state.selectedSearchOptionId}
                        </ButtonDropdown>
                    </div>
                    {this.state.status === "loading" ? <div><Spinner /></div> : <div />}
                    <br />
                    {this.state.embedSearchItems?.length > 0 ?
                        <Button
                            onClick={() => { { this.setState({ filterText: "", inputBytes: null, clipItems: [], items: [], selectedSearchOptionId: "all" }, () => this.populateItems()); } }}
                        >
                            <img className='cleanup' src={BroomIcon} alt="cleanup"></img>
                        </Button> :
                        <Button onClick={() => { this.populateItems(); }}><Icon name="refresh" /></Button>}
                    <div>
                        {this.state.embedSearchItems && this.state.embedSearchItems.map((l, i) => {
                            return <div className="thumb" key={l.TaskId} onClick={({ detail }) => { this.handleSearchFileClick(l); }}>
                                {l.Modality === "video" && <LazyVideoPlayer key={`${l.TaskId}_${l.StartSec}`} src={l.FileUrl} startTime={l.StartSec} controls={false} />}
                                {l.Modality === "image" && <img className='thumbnail' key={`img_${l.TaskId}`} src={l.FileUrl} />}
                                {l.Modality === "text" && <img className='icon' src={TextIcon} key={`txt_${l.TaskId}`} />}
                                {l.Modality === "audio" && <img className='icon' src={AudioIcon} key={`audio_${l.TaskId}`} />}
                                <div className="title">[{l.Modality}] {l.TaskName}</div>
                                <div className="status">
                                    <Badge color={l.Category === "high" ? "green" : l.Category === "medium" ? "severity-medium" : "grey"}>
                                        Distance: {l.Distance?.toFixed(5)}
                                    </Badge>
                                </div>
                                {l.Modality === "video" || l.Modality === "audio" && <div className="timestamp">{DecimalToTimestamp(l.StartSec)} - {DecimalToTimestamp(l.EndSec)} s</div>}
                                {l.Modality === "text" && <div className="timestamp">Char position {l.StartCharPosition} - {l.EndCharPosition}</div>}
                            </div>
                        })}
                        <Modal
                            onDismiss={() => {
                                // Pause all video and audio elements
                                document.querySelectorAll('video, audio').forEach(el => el.pause());
                                this.setState({ showFileDetailModal: false, selectedFile: null });
                            }}
                            visible={this.state.showFileDetailModal}
                            header={`[${this.state.selectedFile?.Modality}] ${this.state.selectedFile?.TaskName}`}
                            footer={
                                <div className="filedetailfooter">
                                    <div className='timestamp'>{this.state.selectedFile?.EmbedCompleteTs && "Embedding time: " + this.calculateTimeDelta(this.state.selectedFile.RequestTs, this.state.selectedFile.EmbedCompleteTs)}</div>
                                    <div className='id'>{this.state.selectedFile?.TaskId}</div>
                                </div>
                            }
                            size="large"
                        >
                            <div className='filedetail'>
                                {this.state.showFileDetailModal && this.state.selectedFile?.Modality === "video" && <div className='videomdoal'>
                                    <VideoPlayer
                                        key={this.state.selectedFile.TaskId}
                                        src={this.state.selectedFile.FileUrl}
                                        startTime={this.state.selectedFile.StartSec}
                                        endTime={this.state.selectedFile.EndSec}
                                        controls={true}
                                        autoPlay={true}
                                        className="videom" />
                                </div>}
                                {this.state.selectedFile?.Modality === "image" && <div className='videomdoal'>
                                    <img src={this.state.selectedFile?.FileUrl} />
                                </div>}
                                {this.state.selectedFile?.Modality === "text" && <div className='videomdoal'>
                                    <TextDetail task={this.state.selectedFile} />
                                </div>}
                                {this.state.showFileDetailModal && this.state.selectedFile?.Modality === "audio" && <div className='videomdoal'>
                                    <AudioPlayer
                                        key={this.state.selectedFile.TaskId}
                                        src={this.state.selectedFile.FileUrl}
                                        startTime={this.state.selectedFile.StartSec}
                                        endTime={this.state.selectedFile.EndSec}
                                        controls={true}
                                        autoPlay={false}
                                        className="videom" />
                                </div>}
                            </div>

                        </Modal>
                        <Modal
                            onDismiss={() => this.setState({ showInputBytesPreviewModeal: false })}
                            visible={this.state.showInputBytesPreviewModeal}
                            size="medium"
                        >
                            <div className='filedetail'>
                                {this.state.inputBytes && <img src={this.state.inputBytes}></img>}
                            </div>

                        </Modal>
                        <Modal
                            onDismiss={() => {
                                // Pause all video and audio elements
                                document.querySelectorAll('video, audio').forEach(el => el.pause());
                                this.setState({ showSearchVideoModal: false, selectedClip: null });
                            }}
                            visible={this.state.showSearchVideoModal}
                            header={`Search Result`}
                            size='large'
                        >
                            <div className='videosearchresultpreview'>
                                {this.state.showSearchVideoModal && this.state.selectedClip?.Modality === "video" && <div className='videomdoal'>
                                    <VideoPlayer
                                        key={this.state.selectedClip.TaskId}
                                        src={this.state.selectedClip.FileUrl}
                                        startTime={this.state.selectedClip.StartSec}
                                        endTime={this.state.selectedClip.EndSec}
                                        controls={true}
                                        autoPlay={true}
                                        className="videom" />
                                    <div className="timestamp">{DecimalToTimestamp(this.state.selectedClip.StartSec)} - {DecimalToTimestamp(this.state.selectedClip.EndSec)} s</div>
                                    <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                                    <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                                </div>}
                                {this.state.showSearchVideoModal && this.state.selectedClip?.Modality === "audio" && <div className='videomdoal'>
                                    <AudioPlayer
                                        key={this.state.selectedClip.TaskId}
                                        src={this.state.selectedClip.FileUrl}
                                        startTime={this.state.selectedClip.StartSec}
                                        endTime={this.state.selectedClip.EndSec}
                                        controls={true}
                                        autoPlay={true}
                                        className="videom" />
                                    <br />
                                    <div className="timestamp">{DecimalToTimestamp(this.state.selectedClip.StartSec)} - {DecimalToTimestamp(this.state.selectedClip.EndSec)} s</div>
                                    <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                                    <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                                </div>}
                                {this.state.selectedClip?.Modality === "image" && <div className='videomdoal'>
                                    <img src={this.state.selectedClip?.FileUrl} />
                                    <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                                    <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                                </div>}
                                {this.state.selectedClip?.Modality === "text" && <div className='videomdoal'>
                                    <div className="desc">{this.state.selectedClip?.Citation}</div>
                                    <br />
                                    <div className="desc">{this.state.selectedClip.EmbeddingOption}</div>
                                    <div className="desc">Distance: {this.state.selectedClip.Distance.toFixed(5)}</div>
                                </div>}
                            </div>

                        </Modal>
                        {this.state.items?.length > 0 ? this.state.items.map((l, i) => {
                            // Check if this is a temp image item (from temp-images.json)
                            if (l.url && l.keywords) {
                                return <div className="thumb" key={`temp_${i}`}>
                                    <img className='thumbnail' src={l.url} alt={l.name} />
                                    <div className="title">[Image] {l.name}</div>
                                    <div className='keywords'>
                                        {l.keywords.slice(0, 3).map((keyword, idx) => (
                                            <span key={idx} className="keyword-tag">{keyword}</span>
                                        ))}
                                        {l.keywords.length > 3 && <span className="keyword-more">+{l.keywords.length - 3} more</span>}
                                    </div>
                                </div>
                            } else {
                                // Regular item format
                                return <div className="thumb" key={l.TaskId}>
                                    {this.getThumbnail(l)}
                                    <div className="title" onClick={({ detail }) => { this.handleTaskClick(l, false); }}>[{l.TaskName.startsWith("doc") ? "Document" : l.Modality}] {l.TaskName}</div>
                                    <div className='status' onClick={({ detail }) => { this.handleTaskClick(l, false); }}>{l.Status}</div>
                                    <div className="timestamp" onClick={({ detail }) => { this.handleTaskClick(l, false); }}>{l.RequestBy}</div>
                                    <div className="timestamp" onClick={({ detail }) => { this.handleTaskClick(l, false); }}>{new Date(l.RequestTs).toLocaleString()}</div>
                                    {this.props.readonlyMode ? <div /> :
                                        <div className='action' onClick={(e) => {
                                            this.setState({
                                                showDeleteConfirmModal: true,
                                                selectedItemId: l.TaskId
                                            })
                                        }}>
                                            <Icon name="remove" visible={!this.props.readonlyMode} /></div>}
                                </div>
                            }
                        }) :
                            this.state.items.length === 0 && this.state.status === null ? 
                            <div className='empty'>Upload a text file, image, video or audio to start</div>
                                : <div />
                        }

                        <Modal
                            onDismiss={() => this.setState({ showDeleteConfirmModal: false })}
                            visible={this.state.showDeleteConfirmModal}
                            header="Delete the video"
                            size='medium'
                            footer={
                                <Box float="right">
                                    <SpaceBetween direction="horizontal" size="xs">
                                        <Button variant="link" onClick={() => this.setState({ showDeleteConfirmModal: false })}>Cancel</Button>
                                        <Button variant="primary" loading={this.state.status === "loading"} onClick={this.handleDelete}>Yes</Button>
                                    </SpaceBetween>
                                </Box>
                            }
                        >
                            Are you sure you want to delete the file and embedding?
                        </Modal>
                    </div>
                    <div className="showmore">
                        <Button
                            loading={this.state.status === "loading"}
                            onClick={() => {
                                this.setState({ pageSize: this.state.pageSize + this.showMoreNumber });
                                this.searchTimer = setTimeout(() => {
                                    this.populateItems();
                                }, 500);
                            }}>Show more</Button>
                    </div>
                </div>
                        


                <Modal
                    onDismiss={() => this.setState({ showUploadModal: false })}
                    visible={this.state.showUploadModal}
                    size='max'
                >
                    <VideoUpload onSubmit={this.handleVideoUpload} onCancel={() => this.setState({ showUploadModal: false })} taskType={this.state.videoActiveTabId} />
                </Modal>
            </div>
        );
    }
}

export default VideoSearch;