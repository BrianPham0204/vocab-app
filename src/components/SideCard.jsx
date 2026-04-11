import React from 'react';

export default function SideCard({ activeTab, hoverDetail, speak, onSaveCurrentWord, canSaveCurrentWord }) {
  const collocation = hoverDetail?.collocation || '—';
  const pattern = hoverDetail?.pattern || hoverDetail?.partern || '—';

  const renderWordDetail = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>{hoverDetail?.vocabulary || hoverDetail?.vietnamMeaning || '—'}</h3>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            const toSpeak = hoverDetail?.vocabulary || hoverDetail?.vietnamMeaning || '';
            if (toSpeak) speak(toSpeak, 'en-US');
          }}
          title="Speak word"
        >
          🔊
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onSaveCurrentWord && onSaveCurrentWord()}
          disabled={!canSaveCurrentWord}
          title="Save to Review"
        >
          Save
        </button>
      </div>

      <p><strong>CAT:</strong> {hoverDetail?.cat || hoverDetail?.type || 'Waiting'}</p>
      <p><strong>Type:</strong> {hoverDetail?.type || '—'}</p>
      <p><strong>Pronunciation:</strong> {hoverDetail?.pronun || '—'}</p>
      <p><strong>Word family:</strong> {hoverDetail?.wordFamily || '—'}</p>
      <p><strong>Synonym:</strong> {hoverDetail?.synonym || '—'}</p>
      <p><strong>Collocation:</strong> {collocation}</p>
      <p><strong>Pattern:</strong> {pattern}</p>
      <p><strong>Meaning:</strong> {hoverDetail?.vietnamMeaning || '—'}</p>

      <div style={{ marginTop: 8 }}>
        <p style={{ margin: '6px 0' }}><strong>Example (EN):</strong></p>
        <div className="example-text">{hoverDetail?.sentences?.en || '—'}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <p style={{ margin: '6px 0' }}><strong>Example (VI):</strong></p>
        <div className="example-text example-text-vi">{hoverDetail?.sentences?.vi || hoverDetail?.sentences_vi || '—'}</div>
      </div>
    </>
  );

  return (
    <>
      <div className="card-header">
        <span className="chip secondary">Thông tin hỗ trợ</span>
        <h2>{activeTab === 'translation' ? 'Hướng dẫn làm bài' : 'Dữ liệu của từ hiện tại'}</h2>
      </div>

      <div className="info-card">
        {activeTab === 'translation' ? (
          hoverDetail ? renderWordDetail() : <p>Di chuột lên một từ trong khung từ gợi ý để xem chi tiết từ tại side card.</p>
        ) : (
          renderWordDetail()
        )}
      </div>
    </>
  );
}
