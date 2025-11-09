import React from 'react';
import './videoSearch.css'; // Use the same CSS as videoSearch
import { Button, Link, Icon } from '@cloudscape-design/components';
// Import will be replaced with fetch from public folder

class KeywordSearch extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            filterText: "",
            displayItems: [],
            allItems: [],
            loading: true
        };
    }

    componentDidMount() {
        // Fetch the images data from public folder
        fetch('/temp/temp-images.json')
            .then(response => response.json())
            .then(data => {
                this.setState({
                    displayItems: data.images,
                    allItems: data.images,
                    loading: false
                });

                // Test if images exist by trying to load the first one
                if (data.images.length > 0) {
                    const testImg = new Image();
                    testImg.onload = () => console.log("✅ First image loaded successfully");
                    testImg.onerror = () => console.log("❌ First image failed to load");
                    testImg.src = data.images[0].url;
                }
            })
            .catch(error => {
                console.error('Error loading temp images:', error);
                this.setState({ loading: false });
            });
    }

    handleSearch = () => {
        const searchText = this.state.filterText.toLowerCase().trim();

        console.log('🔍 SEARCH:', searchText);
        console.log('📊 Total items:', this.state.allItems.length);

        if (!searchText) {
            console.log('🔄 Empty search - showing all');
            this.setState({ displayItems: this.state.allItems });
            return;
        }

        const filtered = this.state.allItems.filter(item => {
            const nameMatch = item.name.toLowerCase().includes(searchText);
            const keywordMatch = item.keywords.some(keyword =>
                keyword.toLowerCase().includes(searchText)
            );
            const matches = nameMatch || keywordMatch;

            if (matches) {
                console.log(`✅ MATCH: ${item.name}`);
            }

            return matches;
        });


        this.setState({ displayItems: filtered }, () => {
            console.log(filtered);
        });
    }

    handleClear = () => {
        this.setState({
            filterText: "",
            displayItems: this.state.allItems
        });
    }

    handleInputChange = (e) => {
        this.setState({ filterText: e.target.value });
    }

    handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            this.handleSearch();
        }
    }

    getImageUrl = (item) => {
        // Try the original URL first
        return item.url;
    }

    getAlternativeImageUrls = (item) => {
        const filename = item.name;
        const alternatives = [
            `/temp/${filename}`,
            `./temp/${filename}`,
            `/public/temp/${filename}`,
            `./public/temp/${filename}`
        ];

        return alternatives;
    }

    render() {
        const { filterText, displayItems, loading } = this.state;

        if (loading) {
            return (
                <div className="mmevideosearch">
                    <div style={{ textAlign: 'center', padding: '20px' }}>
                        Loading images...
                    </div>
                </div>
            );
        }

        return (
            <div className="mmevideosearch">
                {/* Search Section */}
                <div className='searchkwinput'>
                    <div>
                        <input
                            type="text"
                            className="input-text"
                            placeholder="Search by keyword or filename..."
                            value={filterText}
                            onChange={this.handleInputChange}
                            onKeyDown={(e) => { if (e.key === "Enter") this.handleSearch() }}
                        />
                        <div className='clean'>
                            <Link onClick={this.handleClear}>
                                <Icon name="close" />
                            </Link>
                        </div>
                        <div className='search'>
                            <Button variant='primary' onClick={this.handleSearch}>
                                <Icon name="search" />
                            </Button>
                        </div>
                    </div>
                </div>

                {displayItems.length > 0 ? (
                    displayItems.map((item, index) => (
                        <div key={index} className="thumb">
                            <img
                                className='thumbnail'
                                src={this.getImageUrl(item)}
                                alt={item.name}
                                style={{
                                    "width": '100%',
                                    "height": '100%',
                                    objectFit: 'cover',
                                    objectPosition: 'center',
                                    borderRadius: '20px'
                                }}
                                onError={(e) => {
                                    console.log('Failed to load image:', e.target.src);
                                    const alternatives = this.getAlternativeImageUrls(item);
                                    let tried = e.target.getAttribute('data-tried') || 0;
                                    tried = parseInt(tried);

                                    if (tried < alternatives.length) {
                                        console.log(`Trying alternative path ${tried + 1}:`, alternatives[tried]);
                                        e.target.setAttribute('data-tried', tried + 1);
                                        e.target.src = alternatives[tried];
                                    } else {
                                        console.log('All image paths failed for:', item.name);
                                        e.target.style.display = 'none';
                                    }
                                }}
                                onLoad={() => {
                                    console.log('✅ Successfully loaded image:', item.name);
                                }}
                            />
                            <div className="title">[Image] {item.name}</div>
                            <div className="keywords-container">
                                {item.keywords.slice(0, 6).map((keyword, idx) => (
                                    <span
                                        key={idx}
                                        className="keyword-label"
                                        style={{
                                            display: 'inline-block',
                                            color: 'gray',
                                            padding: '3px 8px',
                                            margin: '2px',
                                            borderRadius: '12px',
                                            fontSize: '11px',
                                            fontWeight: '500',
                                            border: '1px solid gray',
                                            whiteSpace: 'nowrap',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.backgroundColor = '#bbdefb';
                                            e.target.style.transform = 'scale(1.05)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.backgroundColor = '#e3f2fd';
                                            e.target.style.transform = 'scale(1)';
                                        }}
                                        onClick={() => {
                                            // Set the keyword as search term
                                            this.setState({ filterText: keyword }, () => {
                                                this.handleSearch();
                                            });
                                        }}
                                        title={`Click to search for "${keyword}"`}
                                    >
                                        {keyword}
                                    </span>
                                ))}
                                {item.keywords.length > 6 && (
                                    <span
                                        className="more-keywords-label"
                                        style={{
                                            display: 'inline-block',
                                            backgroundColor: '#f5f5f5',
                                            color: '#666',
                                            padding: '3px 8px',
                                            margin: '2px',
                                            borderRadius: '12px',
                                            fontSize: '11px',
                                            fontStyle: 'italic',
                                            border: '1px solid #ddd'
                                        }}
                                        title={`${item.keywords.length - 6} more keywords: ${item.keywords.slice(6).join(', ')}`}
                                    >
                                        +{item.keywords.length - 6} more
                                    </span>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="noresult">No images found</div>
                )}
            </div>
        );
    }
}

export default KeywordSearch;