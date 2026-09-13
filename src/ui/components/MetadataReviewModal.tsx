import React, { useState, useEffect } from 'react';

interface ReviewQueueItem {
  id: string;
  gameId: string;
  providerId: string;
  providerGameId: string;
  confidence: string;
  status: string;
  matchedAt: string;
}

interface MetadataReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReviewResolved?: () => void;
}

export const MetadataReviewModal: React.FC<MetadataReviewModalProps> = ({
  isOpen,
  onClose,
  onReviewResolved
}) => {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadQueue = async () => {
    if (!window.gameVault) return;
    setLoading(true);
    try {
      const items = await window.gameVault.getMetadataReviewQueue(50);
      setQueue(items || []);
      if (items && items.length > 0) {
        setSelectedItem(items[0]);
      } else {
        setSelectedItem(null);
      }
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadQueue();
    }
  }, [isOpen]);

  const handleSearchManual = async () => {
    if (!window.gameVault || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await window.gameVault.searchMetadata(searchQuery.trim());
      setSearchResults(results || []);
    } catch (err) {
      console.error('Manual search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmCandidate = async (candidate: any) => {
    if (!window.gameVault || !selectedItem) return;
    try {
      await window.gameVault.resolveMetadataReview(selectedItem.id, 'USER_CONFIRMED', candidate);
      setFeedback(`Matched successfully with "${candidate.title}"!`);
      setTimeout(() => setFeedback(null), 2500);
      await loadQueue();
      onReviewResolved?.();
    } catch (err) {
      console.error('Failed to confirm match:', err);
    }
  };

  const handleReject = async () => {
    if (!window.gameVault || !selectedItem) return;
    try {
      await window.gameVault.resolveMetadataReview(selectedItem.id, 'REJECTED');
      setFeedback('Match rejected.');
      setTimeout(() => setFeedback(null), 2000);
      await loadQueue();
      onReviewResolved?.();
    } catch (err) {
      console.error('Failed to reject match:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '900px',
          maxHeight: '85vh',
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
              Metadata Review Queue
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
              Resolve ambiguous titles or confirm matched game identity
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ✕
          </button>
        </div>

        {feedback && (
          <div
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              borderBottom: '1px solid #10b981',
              color: '#34d399',
              padding: '10px 24px',
              fontSize: '13px'
            }}
          >
            {feedback}
          </div>
        )}

        {/* Content Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: '400px', overflow: 'hidden' }}>
          {/* Left: Pending Games List */}
          <div
            style={{
              width: '320px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              overflowY: 'auto',
              backgroundColor: '#0b1120'
            }}
          >
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                Loading review queue...
              </div>
            ) : queue.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                ✓ No pending games requiring review!
              </div>
            ) : (
              queue.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedItem(item);
                    setSearchResults([]);
                  }}
                  style={{
                    padding: '14px 18px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    cursor: 'pointer',
                    backgroundColor:
                      selectedItem?.id === item.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    borderLeft:
                      selectedItem?.id === item.id ? '3px solid #3b82f6' : '3px solid transparent'
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#f1f5f9' }}>
                    Game ID: {item.gameId.substring(0, 12)}...
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      marginTop: '6px',
                      fontSize: '11px',
                      color: '#94a3b8'
                    }}
                  >
                    <span>Provider: {item.providerId}</span>
                    <span>•</span>
                    <span style={{ color: '#f59e0b' }}>{item.confidence}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right: Candidate Resolution Panel */}
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {selectedItem ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc' }}>
                      Resolve Match for Game
                    </h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                      ID: {selectedItem.gameId} | Confidence: {selectedItem.confidence}
                    </p>
                  </div>
                  <button
                    onClick={handleReject}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Reject Match
                  </button>
                </div>

                {/* Manual Search Bar */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                  <input
                    type="text"
                    placeholder="Search game title manually..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchManual()}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      backgroundColor: '#1e293b',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    onClick={handleSearchManual}
                    disabled={searching}
                    style={{
                      padding: '10px 18px',
                      backgroundColor: '#3b82f6',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontWeight: 500,
                      cursor: searching ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {searching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {/* Results list */}
                {searchResults.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {searchResults.map((cand, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '12px',
                          backgroundColor: '#1e293b',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          gap: '14px'
                        }}
                      >
                        {cand.coverUrl && (
                          <img
                            src={cand.coverUrl}
                            alt=""
                            style={{ width: '48px', height: '64px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                            {cand.title}
                          </div>
                          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                            {cand.platform} • {cand.releaseYear || 'N/A'} • Score: {cand.totalScore || 0}% ({cand.confidence || 'HIGH'})
                          </div>
                        </div>
                        <button
                          onClick={() => handleConfirmCandidate(cand)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#10b981',
                            border: 'none',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Select Match
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
                    Search for a title above to choose the exact match candidate.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: '80px' }}>
                Select a game from the queue on the left to review its match.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
