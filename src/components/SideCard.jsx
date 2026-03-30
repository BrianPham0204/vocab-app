import React from 'react';

export default function SideCard({ activeTab, hoverDetail, speak }) {
  return (
    <>
      <div className="card-header">
        <span className="chip secondary">Thông tin hỗ trợ</span>
        <h2>{activeTab === 'translation' ? 'Hướng dẫn làm bài' : 'Dữ liệu của từ hiện tại'}</h2>
      </div>

      <div className="info-card">
        {activeTab === 'translation' ? (
          <p>Viết lại câu theo hướng dẫn trong đề. So sánh bản dịch của bạn với đáp án tham khảo sau khi bấm Check.</p>
        ) : (
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
            </div>

            <p><strong>Type:</strong> {hoverDetail?.type || '—'}</p>
            <p><strong>Pronunciation:</strong> {hoverDetail?.pronun || '—'}</p>
            <p><strong>Word family:</strong> {hoverDetail?.wordFamily || '—'}</p>
            <p><strong>Synonym:</strong> {hoverDetail?.synonym || '—'}</p>
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
        )}
      </div>
    </>
  );
}
