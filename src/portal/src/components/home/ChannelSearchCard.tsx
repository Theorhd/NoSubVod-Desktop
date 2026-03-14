import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UserInfo } from '../../../../shared/types';

interface ChannelSearchCardProps {
  readonly channelSearch: string;
  readonly setChannelSearch: (value: string) => void;
  readonly isSearchingChannels: boolean;
  readonly searchResults: UserInfo[];
  readonly handleChannelSearch: (e: React.SyntheticEvent) => Promise<void>;
}

export default function ChannelSearchCard({
  channelSearch,
  setChannelSearch,
  isSearchingChannels,
  searchResults,
  handleChannelSearch,
}: ChannelSearchCardProps) {
  const navigate = useNavigate();

  return (
    <div className="card hero-card">
      <h2>Quick channel search</h2>
      <p className="card-subtitle">Find a streamer instantly and jump to recent VODs.</p>
      <form onSubmit={handleChannelSearch}>
        <div className="input-row">
          <input
            type="text"
            id="channelSearch"
            placeholder="e.g. Domingo"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="action-btn" disabled={isSearchingChannels}>
            {isSearchingChannels ? '...' : 'Search'}
          </button>
        </div>
      </form>

      {searchResults.length > 0 && (
        <div className="sub-list">
          {searchResults.map((user) => (
            <div key={user.id} className="sub-item">
              <button
                type="button"
                className="sub-link"
                onClick={() => navigate(`/channel?user=${encodeURIComponent(user.login)}`)}
              >
                <img src={user.profileImageURL} alt={user.displayName} />
                <div className="name">{user.displayName}</div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}