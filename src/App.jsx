import React, { useState, useMemo, useEffect, useRef } from 'react';
import { vocabularyData as localVocabularyData, translationData } from './data/mockData';
import './App.css';
import { convertSheetUrlToCsv, fetchCsvAsText, parseCSV, mapSheetRowsToData } from './utils/sheet';
import { useLocalStorage } from './hooks/useLocalStorage';
import SideCard from './components/SideCard';
import { buildChoiceQuestion, buildWriteWordQuestion, buildTranslationQuestion, normalizeText } from './utils/questions';

const tabs = [
  { id: 'en-to-vi', label: 'Từ Anh → Nghĩa Việt' },
  { id: 'vi-to-en', label: 'Nghĩa Việt → Từ Anh' },
  { id: 'mixed', label: 'Trắc nghiệm 4 đáp án' },
  { id: 'write-word', label: 'Viết Lại Từ' },
  { id: 'review', label: 'Review' },
  { id: 'translation', label: 'Viết lại câu' }
];

export default function App() {
  // persisted settings and data
  const [sheetUrl, setSheetUrl] = useLocalStorage('vocab_sheet_url', '');
  const [mapping, setMapping] = useLocalStorage('vocab_mapping', {
    vocabulary: '',
    type: '',
    pronun: '',
    vietnamMeaning: '',
    wordFamily: '',
    synonym: '',
    sentences_en: '',
    sentences_vi: '',
    learn: ''
  });
  const [dataList, setDataList] = useLocalStorage('vocab_data', localVocabularyData || []);
  // review list (wrong answers)
  const [reviewList, setReviewList] = useLocalStorage('vocab_review', []);

  // UI state
  const [activeTab, setActiveTab] = useState('en-to-vi');
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [sheetPreviewRows, setSheetPreviewRows] = useState([]);
  // persistent voice toggle (shortcut 'v')
  const [voiceEnabled, setVoiceEnabled] = useLocalStorage('vocab_voice_enabled', false);
  const [draggingHeader, setDraggingHeader] = useState(null);
  const [dropHover, setDropHover] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // random order per tab so words show randomly
  const [orders, setOrders] = useState({
    'en-to-vi': [],
    'vi-to-en': [],
    mixed: [],
    'write-word': []
  });
  const [showSentence, setShowSentence] = useState(false);
  // option hover state: which answer the mouse is currently over (null => use first option)
  const [hoveredOption, setHoveredOption] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  // suppress hover immediately after question change (prevents remount-triggered onMouseEnter)
  const ignoreHoverUntilRef = useRef(0);
  
  // regenerate random orders whenever the data source changes
  useEffect(() => {
    const n = (dataList && dataList.length) || 0;
    if (n === 0) {
      // keep all known tabs present (including write-word) to avoid missing keys
      setOrders({ 'en-to-vi': [], 'vi-to-en': [], mixed: [], 'write-word': [] });
      return;
    }
    const makeOrder = () => {
      const arr = Array.from({ length: n }, (_, i) => i);
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    setOrders({
      'en-to-vi': makeOrder(),
      'vi-to-en': makeOrder(),
      mixed: makeOrder(),
      'write-word': makeOrder()
    });
  }, [dataList]);

  // quiz state
  const [quizState, setQuizState] = useState({
    'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    'write-word': { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
    translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 }
  });

  // disabled map for wrong choices per tab/index
  const [disabledMap, setDisabledMap] = useState({});

  useEffect(() => {
    // fetch preview & suggest mapping when sheetUrl set (exposed as Preview button)
    const fetchSheetPreview = async () => {
      if (!sheetUrl) {
        setSheetHeaders([]);
        setSheetPreviewRows([]);
        return;
      }
      try {
        const csvUrl = convertSheetUrlToCsv(sheetUrl);
        const txt = await fetchCsvAsText(csvUrl);
        const { headers, rows } = parseCSV(txt);
        setSheetHeaders(headers || []);
        setSheetPreviewRows((rows && rows.slice(0, 5)) || []);
        // suggest reasonable defaults for all supported columns (case and position flexible)
        const findHeader = (candidates) => {
          if (!headers || headers.length === 0) return '';
          if (Array.isArray(candidates)) {
            for (const name of candidates) {
              const h = headers.find((hh) => String(hh).trim().toLowerCase() === String(name).trim().toLowerCase());
              if (h) return h;
            }
            return '';
          }
          const re = typeof candidates === 'string' ? new RegExp(candidates, 'i') : candidates;
          return headers.find((h) => re.test(h)) || '';
        };
        setMapping((m) => ({
          ...m,
          vocabulary: m.vocabulary || headers[0] || findHeader(/vocab|vocabulary/i),
          type: m.type || findHeader(/type|pos|class/i),
          pronun: m.pronun || findHeader(/pronun|pronounce|phonetic|pron/i),
          vietnamMeaning: m.vietnamMeaning || findHeader(/meaning|viet|vietnam/i),
          wordFamily: m.wordFamily || findHeader(/word ?family|family/i),
          synonym: m.synonym || findHeader(/synonym|syn/i),
          sentences_en: m.sentences_en || findHeader(/sentence|example.*en|en_sentence|sentences_en/i),
          sentences_vi: m.sentences_vi || findHeader(/sentence.*vi|vi_sentence|sentences_vi/i),
          learn: m.learn || findHeader(/learn/i)
        }));
      } catch (e) {
        console.error('Failed to fetch sheet preview:', e);
        setSheetHeaders([]);
        setSheetPreviewRows([]);
      }
    };

    // auto-preview when sheetUrl changes
    fetchSheetPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetUrl]);

  const currentQuestion = useMemo(() => {
    if (activeTab === 'translation') {
      return buildTranslationQuestion(quizState.translation.index, translationData);
    }
    if (activeTab === 'write-word') {
      // map logical to randomized index same as other tabs
      const order = orders[activeTab] && orders[activeTab].length ? orders[activeTab] : null;
      const logicalIndex = quizState[activeTab].index || 0;
      const dataIndex = order ? order[logicalIndex % order.length] : logicalIndex;
      return buildWriteWordQuestion(dataList, dataIndex);
    }
    // map logical quiz index to a randomized data index per tab (orders)
    const order = orders[activeTab] && orders[activeTab].length ? orders[activeTab] : null;
    const logicalIndex = quizState[activeTab].index || 0;
    const dataIndex = order ? order[logicalIndex % order.length] : logicalIndex;
    return buildChoiceQuestion(dataList, activeTab, dataIndex);
  }, [activeTab, quizState, dataList, orders]);

  const currentTabState = quizState[activeTab];

  // detail object for side frame:
  // - for write-word tab, always show the correct answer's data (currentQuestion.detail)
  // - otherwise, prefer the chosen answer (selected) if any, then last hovered option, then first option as default
  const hoverDetail = useMemo(() => {
    if (!currentQuestion) return null;

    // write-word should always show the answer detail
    if (activeTab === 'write-word') return currentQuestion.detail || null;

    const options = currentQuestion.options || [];
    // prefer hovered option (mouse) first, then selected answer, then first option as fallback
    const optToMatch = hoveredOption ?? ((currentTabState && currentTabState.selected) || (options.length ? options[0] : null));
    if (!optToMatch) return currentQuestion.detail || null;

    // try find matching row in dataList: match vocabulary or vietnamMeaning (robust compare)
    const norm = (s) => normalizeText(String(s || ''));
    const targetNorm = norm(optToMatch);
    const found = (dataList || []).find((it) => {
      if (!it) return false;
      if (String(it.vocabulary || '') === optToMatch) return true;
      if (String(it.vietnamMeaning || '') === optToMatch) return true;
      if (norm(it.vocabulary) === targetNorm) return true;
      if (norm(it.vietnamMeaning) === targetNorm) return true;
      return false;
    });
    return found || currentQuestion.detail || null;
  }, [hoveredOption, currentQuestion, dataList, activeTab, currentTabState]);
  // clear hover when question changes (keeps default first option)
  useEffect(() => {
    // do NOT clear hoveredOption here — keep last mouse-pointed vocab across navigation
    // only suppress immediate onMouseEnter events from remounted buttons
    ignoreHoverUntilRef.current = Date.now() + 300;
  }, [currentQuestion?.id]);
  
  const updateTabState = (tabId, partial) => {
    setQuizState((prev) => ({
      ...prev,
      [tabId]: {
        ...prev[tabId],
        ...partial
      }
    }));
  };

  const pushUndoSnapshot = () => {
    setUndoStack((prev) => [
      ...prev.slice(-19),
      {
        activeTab,
        quizState,
        disabledMap,
        reviewList,
        hoveredOption
      }
    ]);
  };

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setActiveTab(last.activeTab);
      setQuizState(last.quizState);
      setDisabledMap(last.disabledMap);
      setReviewList(last.reviewList);
      setHoveredOption(last.hoveredOption ?? null);
      return prev.slice(0, -1);
    });
  };

  // drag/drop handlers
  const handleDragStart = (e, hdr) => {
    try { e.dataTransfer.setData('text/plain', hdr); } catch (err) {}
    setDraggingHeader(hdr);
  };
  const handleDragEnd = () => {
    setDraggingHeader(null);
    setDropHover(null);
  };
  const handleDragOverSlot = (e, field) => {
    e.preventDefault();
    setDropHover(field);
  };
  const handleDragLeaveSlot = () => {
    setDropHover(null);
  };
  const handleDropToField = (e, field) => {
    e.preventDefault();
    const hdr = e.dataTransfer.getData('text/plain') || draggingHeader;
    if (!hdr) return;
    setMapping((m) => ({ ...m, [field]: hdr }));
    setDraggingHeader(null);
    setDropHover(null);
  };
  const clearMappingField = (field) => setMapping((m) => ({ ...m, [field]: '' }));

  // speak helper using Web Speech API
  const speak = (text, lang = 'en-US') => {
    try {
      if (!text) return;
      const utter = new SpeechSynthesisUtterance(String(text));
      utter.lang = lang;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch (e) {
      // ignore if not supported
      // console.warn('Speech not supported', e);
    }
  };

  // selection behavior: immediate feedback; wrong disables that option; Next moves on (no auto-advance)
  const handleSelect = (option) => {
    if (activeTab === 'translation') return;
    if (currentTabState.checked) return;
    pushUndoSnapshot();
 
    const idx = quizState[activeTab].index;
    const isCorrect = option === currentQuestion.answer;
 
    if (isCorrect) {
      updateTabState(activeTab, {
        selected: option,
        checked: true,
        feedback: 'Chính xác.',
        score: currentTabState.score + 1,
        answered: currentTabState.answered + 1
      });
      setDisabledMap((prev) => {
        const tabMap = { ...(prev[activeTab] || {}) };
        tabMap[idx] = { lockAll: true };
        return { ...prev, [activeTab]: tabMap };
      });
    } else {
      updateTabState(activeTab, {
        feedback: `Sai. Đáp án đúng: ${currentQuestion.answer}`,
        answered: currentTabState.answered + 1
      });
      // add to review collection
      try {
        const entry = {
          ts: Date.now(),
          tab: activeTab,
          prompt: currentQuestion.prompt,
          attempt: option,
          answer: currentQuestion.answer,
          detail: currentQuestion.detail || null
        };
        setReviewList((prev) => {
          const exists = (prev || []).some((r) => r.detail?.vocabulary === entry.detail?.vocabulary && r.attempt === entry.attempt && r.tab === entry.tab);
          if (exists) return prev;
          return [...(prev || []), entry];
        });
      } catch (e) { /* ignore */ }
       setDisabledMap((prev) => {
         const tabMap = { ...(prev[activeTab] || {}) };
         const entry = tabMap[idx] || { lockAll: false, disabledOptions: [] };
         const disabledOptions = new Set(entry.disabledOptions || []);
         disabledOptions.add(option);
         tabMap[idx] = { ...entry, disabledOptions: Array.from(disabledOptions) };
         return { ...prev, [activeTab]: tabMap };
       });
     }
  };

  // return normalized list of acceptable answers for a question (vocabulary + synonyms)
  const getAcceptableAnswers = (question) => {
    if (!question) return [];
    const list = [];
    if (question.answer) list.push(String(question.answer).trim());
    const synRaw = question.detail?.synonym || question.detail?.synonyms || '';
    if (synRaw) {
      // split common separators: / , ; | and also " / " style
      const parts = String(synRaw).split(/[\/,;|]+/).map((s) => String(s || '').trim()).filter(Boolean);
      for (const p of parts) list.push(p);
    }
    // unique and normalized
    const uniq = Array.from(new Set(list));
    return uniq.map((s) => normalizeText(s));
  };

  const handleCheck = () => {
    if (!(activeTab === 'translation' || activeTab === 'write-word')) return;
    pushUndoSnapshot();
    const input = currentTabState.input || '';
    const normalizedInput = normalizeText(input);
 
    // For write-word tab accept vocabulary OR any synonym token
    if (activeTab === 'write-word') {
      const acceptable = getAcceptableAnswers(currentQuestion); // normalized list
      const isCorrect = acceptable.includes(normalizedInput);
      updateTabState(activeTab, {
        checked: true,
        feedback: isCorrect
          ? 'Chính xác.'
          : `Chưa đúng. Đáp án tham khảo: ${[currentQuestion.answer, currentQuestion.detail?.synonym].filter(Boolean).join(' / ')}`,
        score: currentTabState.score + (isCorrect ? 1 : 0),
        answered: currentTabState.answered + 1
      });
      if (!isCorrect) {
        try {
          const entry = {
            ts: Date.now(),
            tab: activeTab,
            prompt: currentQuestion.prompt,
            attempt: input,
            answer: currentQuestion.answer,
            detail: currentQuestion.detail || null
          };
          setReviewList((prev) => {
            const exists = (prev || []).some((r) => r.detail?.vocabulary === entry.detail?.vocabulary && r.attempt === entry.attempt && r.tab === entry.tab);
            if (exists) return prev;
            return [...(prev || []), entry];
          });
        } catch (e) {}
      }
      return;
    }
 
    // fallback / translation tab: exact match with normalized answer
    const normalizedAnswer = normalizeText(currentQuestion.answer || '');
    const isCorrect = normalizedInput === normalizedAnswer;
    updateTabState(activeTab, {
      checked: true,
      feedback: isCorrect
        ? 'Chính xác.'
        : `Chưa đúng. Đáp án tham khảo: ${currentTabState.answer}`,
      score: currentTabState.score + (isCorrect ? 1 : 0),
      answered: currentTabState.answered + 1
    });
    if (!isCorrect) {
      try {
        const entry = {
          ts: Date.now(),
          tab: activeTab,
          prompt: currentQuestion.prompt,
          attempt: input,
          answer: currentQuestion.answer,
          detail: currentQuestion.detail || null
        };
        setReviewList((prev) => {
          const exists = (prev || []).some((r) => r.detail?.vocabulary === entry.detail?.vocabulary && r.attempt === entry.attempt && r.tab === entry.tab);
          if (exists) return prev;
          return [...(prev || []), entry];
        });
      } catch (e) {}
    }
  };

  const clearDisabledForIndex = (tabId, idx) => {
    setDisabledMap((prev) => {
      const tabMap = { ...(prev[tabId] || {}) };
      delete tabMap[idx];
      return { ...prev, [tabId]: tabMap };
    });
  };

  const handleNext = () => {
    pushUndoSnapshot();
    // wrap / recycle when reaching list length
    if (activeTab === 'translation' || activeTab === 'write-word') {
      const len = (dataList && dataList.length) || 1;
      const newIndex = (quizState[activeTab].index + 1) % len;
      updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '' });
      clearDisabledForIndex(activeTab, newIndex);
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (dataList && dataList.length) || 1;
    const newIndex = (currentTabState.index + 1) % len;
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '' });
    clearDisabledForIndex(activeTab, newIndex);
  };

  // keyboard: Tab advances to next question; 'v' speaks the displayed word (skip when typing)
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = e.key;
      const tgt = e.target;
      const tag = tgt && tgt.tagName && String(tgt.tagName).toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || tgt?.isContentEditable || tag === 'select';

      if (key === 'Tab') {
        if (isEditable) return; // allow normal tabbing while typing
        e.preventDefault();
        try { handleNext(); } catch (err) { /* ignore */ }
        return;
      }

      if (key && key.toLowerCase() === 'v') {
        if (isEditable) return; // avoid speaking while typing
        e.preventDefault();
        const displayed = hoverDetail?.vocabulary || hoverDetail?.vietnamMeaning || currentQuestion?.detail?.vocabulary || currentQuestion?.vocabulary || '';
        if (displayed) {
          try { speak(displayed, 'en-US'); } catch (err) { /* ignore */ }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && key && key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoverDetail, currentQuestion, activeTab, quizState, dataList, orders, currentTabState, disabledMap, reviewList, hoveredOption]);

  const handlePrev = () => {
    pushUndoSnapshot();
    // wrap backwards
    if (activeTab === 'translation' || activeTab === 'write-word') {
      const len = (dataList && dataList.length) || 1;
      const newIndex = (quizState[activeTab].index - 1 + len) % len;
      updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '' });
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (dataList && dataList.length) || 1;
    const newIndex = (currentTabState.index - 1 + len) % len;
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '' });
  };

  const handleReset = () => {
    pushUndoSnapshot();
    if (activeTab === 'translation' || activeTab === 'write-word') {
      updateTabState(activeTab, { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 });
      setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
      return;
    }
    updateTabState(activeTab, { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 });
    setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
  };

  // sheet preview & mapping
  const fetchSheetPreview = async () => {
    if (!sheetUrl) return;
    const csvUrl = convertSheetUrlToCsv(sheetUrl);
    try {
      const txt = await fetchCsvAsText(csvUrl);
      const { headers, rows } = parseCSV(txt);
      setSheetHeaders(headers);
      setSheetPreviewRows(rows.slice(0, 5));
      // suggest reasonable defaults for all supported columns (case and position flexible)
      const findHeader = (candidates) => {
        if (!headers || headers.length === 0) return '';
        // candidates can be a regex or array of names (case-insensitive)
        if (Array.isArray(candidates)) {
          for (const name of candidates) {
            const h = headers.find((hh) => String(hh).trim().toLowerCase() === String(name).trim().toLowerCase());
            if (h) return h;
          }
          return '';
        }
        // regex
        const re = typeof candidates === 'string' ? new RegExp(candidates, 'i') : candidates;
        return headers.find((h) => re.test(h)) || '';
      };

      setMapping((m) => ({
        ...m,
        vocabulary: m.vocabulary || headers[0] || findHeader(/vocab|vocabulary/i),
        type: m.type || findHeader(/type|pos|class/i),
        pronun: m.pronun || findHeader(/pronun|pronounce|phonetic|pron/i),
        vietnamMeaning: m.vietnamMeaning || findHeader(/meaning|viet|vietnam/i),
        wordFamily: m.wordFamily || findHeader(/word ?family|family/i),
        synonym: m.synonym || findHeader(/synonym|syn/i),
        sentences_en: m.sentences_en || findHeader(/sentence|example.*en|en_sentence|sentences_en/i),
        sentences_vi: m.sentences_vi || findHeader(/sentence.*vi|vi_sentence|sentences_vi/i),
        learn: m.learn || findHeader(/learn/i)
      }));
    } catch (e) {
      console.error('Failed to fetch sheet preview:', e);
      setSheetHeaders([]);
      setSheetPreviewRows([]);
    }
  };

  const applyMappingToData = async () => {
    if (!sheetUrl || !sheetHeaders.length) return;
    const csvUrl = convertSheetUrlToCsv(sheetUrl);
    try {
      const txt = await fetchCsvAsText(csvUrl);
      const { rows } = parseCSV(txt);
      const mapped = mapSheetRowsToData(rows, mapping);
      if (mapped.length) {
        setDataList(mapped);
        setQuizState({
          'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          'write-word': { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
          translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 }
        });
        setDisabledMap({});
        setSettingsOpen(false);
      } else {
        console.warn('No rows mapped from sheet with given mapping.');
      }
    } catch (e) {
      console.error('Apply mapping failed:', e);
    }
  };

  if (!currentQuestion && activeTab !== 'review') {
    return (
      <div className="app-shell">
        <main className="container">
          <section style={{ padding: 24 }}>
            <h2>No question available</h2>
            <p>Data list length: {dataList?.length || 0}. Use Settings to load a sheet or check mapping.</p>
          </section>
        </main>
      </div>
    );
  }

  const indexKey = quizState[activeTab].index;
  const tabDisabledEntry = (disabledMap[activeTab] || {})[indexKey] || { disabledOptions: [], lockAll: false };
  const disabledOptionsForCurrent = new Set(tabDisabledEntry.disabledOptions || []);
  const lockAllForCurrent = !!tabDisabledEntry.lockAll;

  // resolved learn preview header key (case-insensitive / tolerant)
  const learnPreviewKey = (() => {
    if (!mapping.learn || !sheetHeaders || !sheetHeaders.length) return null;
    const t = String(mapping.learn).trim().toLowerCase();
    let k = sheetHeaders.find((hh) => String(hh).trim().toLowerCase() === t);
    if (k) return k;
    k = sheetHeaders.find((hh) => {
      const hnorm = String(hh).trim().toLowerCase();
      return hnorm.includes(t) || t.includes(hnorm);
    });
    return k || null;
  })();

  return (
    <div className="app-shell">
      <div className="background-blur blur-one" />
      <div className="background-blur blur-two" />
      <main className="container">
        <section className="hero-card">
          <div>
            <span className="eyebrow">English Practice Web App</span>
            <h1>Kiểm tra từ vựng, cách dùng và đặt câu</h1>
            <p>Bản demo: dùng Settings để nối Google Sheets hoặc dùng dữ liệu mẫu.</p>
          </div>
          <div className="score-board">
            <div className="score-item"><span>Điểm</span><strong>{currentTabState.score}</strong></div>
            <div className="score-item"><span>Đã làm</span><strong>{currentTabState.answered}</strong></div>
            <div className="score-item"><span>Tab</span><strong>{tabs.find((t) => t.id === activeTab)?.label}</strong></div>
            <div style={{ marginLeft: 12 }}><button className="ghost-button" onClick={() => setSettingsOpen((s) => !s)}>Settings</button></div>
          </div>
        </section>

        {settingsOpen && (
          <section className="settings-panel" style={{ marginBottom: 18 }}>
            <h3>Data Source / Google Sheets</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ flex: 1 }} placeholder="Paste Google Sheet URL (or CSV URL)" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
              <button onClick={fetchSheetPreview} className="primary-button">Preview</button>
              <button onClick={applyMappingToData} className="secondary-button">Apply mapping</button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <h4>Headers (drag from here)</h4>
                <div className="headers-list">
                  {sheetHeaders.length ? sheetHeaders.map((h) => (
                    <div key={h} draggable onDragStart={(e) => handleDragStart(e, h)} onDragEnd={handleDragEnd} className="draggable-header" title="Drag to a mapping slot">
                      {h}
                    </div>
                  )) : <em>No headers previewed</em>}
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <h4>Map headers to schema (drop header onto a slot)</h4>
                {['vocabulary','type','pronun','vietnamMeaning','wordFamily','synonym','sentences_en','sentences_vi','learn'].map((field) => (
                   <div key={field} onDragOver={(e) => handleDragOverSlot(e, field)} onDragLeave={handleDragLeaveSlot} onDrop={(e) => handleDropToField(e, field)} className={`mapping-slot ${dropHover === field ? 'hover' : ''}`}>
                     <label>{field}</label>
                     <div className="mapping-value">
                       {mapping[field]
                         ? <>
                             <span className="mapped-name">{mapping[field]}</span>
                             <button type="button" className="clear-mapping" onClick={() => clearMappingField(field)} title="Clear mapping">✕</button>
                             <span className="connected-badge" title="Mapped">✓</span>
                           </>
                         : <em>drop header here</em>
                       }
                     </div>
                   </div>
                 ))}
              </div>
            </div>

            <h4 style={{ marginTop: 12 }}>Preview Rows (first 5)</h4>
            <div className="preview-table">
              {sheetPreviewRows && sheetPreviewRows.length ? (
                <table>
                  <thead>
                    <tr>
                      {sheetHeaders.map((h) => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetPreviewRows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {sheetHeaders.map((h, idx) => <td key={idx}>{r[h] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <em>No preview</em>
              )}
            </div>

            {/* Mapping test: show mapped header + sample preview value for each schema field */}
            <div style={{ marginTop: 12, padding: 8, borderTop: '1px solid #eee' }}>
              <h4>Mapping test (preview row sample)</h4>
              {sheetHeaders && sheetHeaders.length ? (() => {
                const findHeaderKey = (target) => {
                  if (!target) return null;
                  const t = String(target).trim().toLowerCase();
                  let k = sheetHeaders.find((hh) => String(hh).trim().toLowerCase() === t);
                  if (k) return k;
                  k = sheetHeaders.find((hh) => {
                    const hnorm = String(hh).trim().toLowerCase();
                    return hnorm.includes(t) || t.includes(hnorm);
                  });
                  return k || null;
                };

                const sampleRow = sheetPreviewRows && sheetPreviewRows.length ? sheetPreviewRows[0] : null;
                const fields = ['vocabulary','type','pronun','vietnamMeaning','wordFamily','synonym','sentences_en','sentences_vi','learn'];
                return (
                  <table style={{ width: '100%', fontSize: 13, marginTop: 8 }}>
                    <thead>
                      <tr><th style={{ textAlign: 'left' }}>Field</th><th style={{ textAlign: 'left' }}>Mapped header</th><th style={{ textAlign: 'left' }}>Preview sample</th></tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => {
                        const hdr = mapping[f] || '';
                        const resolvedKey = hdr ? findHeaderKey(hdr) : null;
                        const sample = sampleRow && resolvedKey ? (sampleRow[resolvedKey] ?? '—') : '—';
                        return (
                          <tr key={f}>
                            <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{f}</td>
                            <td style={{ padding: '6px 8px', verticalAlign: 'top', color: resolvedKey ? '#000' : '#b00' }}>{resolvedKey || hdr || <em>none</em>}</td>
                            <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{String(sample)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })() : <em>No headers to test</em>}
            </div>
          </section>
        )}

        <section className="tabs-section">
          <div className="tabs-list">
            {tabs.map((tab) => (
              <button key={tab.id} className={`tab-button ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
            ))}
          </div>
        </section>

        <section className="practice-grid">
          <article className="question-card">
             <div className="card-header">
              <span className="chip">
                {activeTab === 'translation' ? 'Viết tự do' : activeTab === 'review' ? 'Review' : 'Multiple Choice'}
              </span>
              <h2>
                {activeTab === 'translation' ? 'Hiển thị câu và viết lại'
                  : activeTab === 'review' ? `Review (${(reviewList || []).length})`
                  : currentQuestion?.title}
              </h2>
             </div>
            <div className="prompt-box">
              <span className="prompt-label">{activeTab === 'translation' ? 'Đề bài' : 'Câu hỏi'}</span>
              <p>{currentQuestion?.prompt}</p>
            </div>

            {activeTab === 'translation' ? (
              <div className="translation-area">
                <textarea
                  value={currentTabState.input}
                  onChange={(e) => updateTabState('translation', { input: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter = submit (check) when non-empty
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if ((currentTabState.input || '').trim()) handleCheck();
                    }
                    // Tab = next (move to next question)
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      handleNext();
                    }
                  }}
                  placeholder="Nhập câu trả lời của bạn ở đây..."
                />
              </div>
            ) : activeTab === 'write-word' ? (
              <div className="translation-area">
                <textarea
                  value={currentTabState.input}
                  onChange={(e) => updateTabState('write-word', { input: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter = submit (check) when non-empty
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if ((currentTabState.input || '').trim()) handleCheck();
                    }
                    // Tab = next (move to next question)
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      handleNext();
                    }
                  }}
                  placeholder="Nhập từ tiếng Anh tương ứng..."
                />
              </div>
            ) : (
               <div className="options-grid">
                 {currentQuestion?.options?.map((option, idx) => {
                   const isDisabledOption = disabledOptionsForCurrent.has(option);
                   const disabled = lockAllForCurrent || isDisabledOption;
                   const className = `option-button ${currentTabState.selected === option ? (lockAllForCurrent && option === currentQuestion.answer ? 'correct' : 'selected') : ''} ${isDisabledOption ? 'blurred' : ''}`;
                   const handleOptionMouseEnter = (opt) => {
                     if (Date.now() < ignoreHoverUntilRef.current) return;
                     setHoveredOption(opt);
                   };
                   return (
                     // wrapper captures mouse events even when inner button is disabled
                     <div
                       key={`${currentQuestion.id}-opt-wrap-${idx}`}
                       className="option-wrapper"
                       onMouseEnter={() => handleOptionMouseEnter(option)}
                       onTouchStart={() => handleOptionMouseEnter(option)}
                     >
                       <button
                         key={`${currentQuestion.id}-opt-${idx}`}
                         className={className}
                         onClick={() => handleSelect(option)}
                         onFocus={() => handleOptionMouseEnter(option)}
                         /* keep hoveredOption set to the last option the mouse pointed at — do not clear on mouse leave */
                         disabled={disabled}
                       >
                         {option}
                       </button>
                     </div>
                   );
                 })}
               </div>
             )}
            <div className={`feedback-box ${currentTabState.feedback ? 'show' : ''}`}>{currentTabState.feedback || 'Chọn đáp án.'}</div>

            <div className="actions">
              <button className="secondary-button" onClick={handleNext}>Next</button>
              <button className="ghost-button" onClick={handleReset}>Reset</button>
              <button className="ghost-button" onClick={handleUndo} disabled={!undoStack.length}>Undo</button>
            </div>

            <div className="data-structure learn-panel">
              <span className="info-label">Learn column (for current word)</span>
              {hoverDetail?.learn ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{String(hoverDetail.learn)}</div>
              ) : learnPreviewKey ? (
                <div>
                  <strong>Preview (no mapped learn for current word)</strong>
                  <ul>
                    {sheetPreviewRows.slice(0, 5).map((r, i) => <li key={i}>{r[learnPreviewKey] || '—'}</li>)}
                  </ul>
                </div>
              ) : (
                <div>
                  <p style={{ margin: 0 }}>No "Learn" data for the current word.</p>
                  <p style={{ marginTop: 6, fontSize: 13, color: '#666' }}>
                    Ensure the "learn" slot is mapped in Settings and Apply mapping.
                  </p>
                </div>
              )}
            </div>
          </article>

          <aside className="side-card">
            <SideCard
              activeTab={activeTab}
              hoverDetail={hoverDetail}
              speak={(text, lang) => speak(text, lang)}
            />
          </aside>
        </section>
      </main>
    </div>
  );
}
