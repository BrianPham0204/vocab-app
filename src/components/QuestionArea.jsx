// ...new file...
import React from 'react';

export default function QuestionArea(props) {
  // props: activeTab, currentQuestion, currentTabState, disabledOptionsForCurrent, lockAllForCurrent,
  // onSelect, onCheck, onNext, onPrev, onReset, onHoverOption, onChangeInput
  const {
    activeTab, currentQuestion, currentTabState, disabledOptionsForCurrent, lockAllForCurrent,
    onSelect, onCheck, onNext, onPrev, onReset, onHoverOption, onChangeInput
  } = props;

  if (!currentQuestion) return null;

  return (
    <>
      <div className="prompt-box">
        <span className="prompt-label">{activeTab === 'translation' ? 'Đề bài' : 'Câu hỏi'}</span>
        <p>{currentQuestion.prompt}</p>
      </div>

      {activeTab === 'translation' ? (
        <div className="translation-area">
          <textarea value={currentTabState.input} onChange={(e) => onChangeInput('translation', e.target.value)} placeholder="Nhập câu trả lời của bạn ở đây..." />
        </div>
      ) : activeTab === 'write-word' ? (
        <div className="translation-area">
          <textarea value={currentTabState.input} onChange={(e) => onChangeInput('write-word', e.target.value)} placeholder="Nhập từ tiếng Anh tương ứng..." />
        </div>
      ) : (
        <div className="options-grid">
          {currentQuestion.options.map((option, idx) => {
            const isDisabledOption = disabledOptionsForCurrent.has(option);
            const disabled = lockAllForCurrent || isDisabledOption;
            const className = `option-button ${currentTabState.selected === option ? (lockAllForCurrent && option === currentQuestion.answer ? 'correct' : 'selected') : ''} ${isDisabledOption ? 'blurred' : ''}`;
            return (
              <button
                key={`${currentQuestion.id}-opt-${idx}`}
                className={className}
                onClick={() => onSelect(option)}
                onMouseEnter={() => onHoverOption(option)}
                disabled={disabled}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      <div className={`feedback-box ${currentTabState.feedback ? 'show' : ''}`}>{currentTabState.feedback || 'Chọn đáp án.'}</div>

      <div className="actions">
        <button className="ghost-button" onClick={onPrev} disabled={currentTabState.index === 0}>Prev</button>
        {(activeTab === 'translation' || activeTab === 'write-word') && (
          <button className="primary-button" onClick={onCheck}>Check</button>
        )}
        <button className="secondary-button" onClick={onNext}>Next</button>
        <button className="ghost-button" onClick={onReset}>Reset</button>
      </div>
    </>
  );
}
// ...end file...