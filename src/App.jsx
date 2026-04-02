import React, { useState, useMemo, useEffect, useRef } from 'react';
import { vocabularyData as localVocabularyData, translationData } from './data/mockData';
import './App.css';
import { convertSheetUrlToCsv, fetchCsvAsText, parseCSV, mapSheetRowsToData } from './utils/sheet';
import { useLocalStorage } from './hooks/useLocalStorage';
import SideCard from './components/SideCard';
import { buildChoiceQuestion, buildWriteWordQuestion, buildTranslationQuestion, normalizeText } from './utils/questions';
import { requestTranslation } from './utils/translate';

const tabs = [
  { id: 'en-to-vi', label: 'Từ Anh → Nghĩa Việt' },
  { id: 'vi-to-en', label: 'Nghĩa Việt → Từ Anh' },
  { id: 'mixed', label: 'Trắc nghiệm 4 đáp án' },
  { id: 'write-word', label: 'Viết Lại Từ' },
  { id: 'review', label: 'Review' },
  { id: 'translation', label: 'Viết lại câu' }
];
const practiceTabs = ['en-to-vi', 'vi-to-en', 'mixed', 'write-word'];

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
  const [practiceSource, setPracticeSource] = useLocalStorage('vocab_practice_source', 'all');
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [sheetPreviewRows, setSheetPreviewRows] = useState([]);
  // persistent voice toggle (shortcut 'v')
  const [voiceEnabled, setVoiceEnabled] = useLocalStorage('vocab_voice_enabled', false);
  const [draggingHeader, setDraggingHeader] = useState(null);
  const [dropHover, setDropHover] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translateConfig, setTranslateConfig] = useLocalStorage('vocab_translate_config', {
    endpoint: import.meta.env.VITE_TRANSLATE_API_URL || '',
    sourceLang: 'en',
    targetLang: 'vi'
  });

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
  const [translatePopover, setTranslatePopover] = useState({
    open: false,
    text: '',
    translatedText: '',
    source: '',
    loading: false,
    error: '',
    mode: 'floating',
    placement: 'below',
    x: 0,
    y: 0
  });
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [sourceSlapActive, setSourceSlapActive] = useState(false);
  const isPracticeTab = practiceTabs.includes(activeTab);
  // suppress hover immediately after question change (prevents remount-triggered onMouseEnter)
  const ignoreHoverUntilRef = useRef(0);
  const translateAbortRef = useRef(null);
  const translateCacheRef = useRef(new Map());
  const translatePopupRef = useRef(null);
  const savedToastTimerRef = useRef(null);
  const sourceSlapTimerRef = useRef(null);
  
  const reviewSourceData = useMemo(() => {
    const list = Array.isArray(reviewList) ? reviewList : [];
    const byKey = new Map();
    list.forEach((entry) => {
      const detail = entry?.detail || null;
      const word = String(detail?.vocabulary || entry?.word || entry?.answer || '').trim();
      const meaning = String(detail?.vietnamMeaning || entry?.meaning || '').trim();
      const key = normalizeText(word || meaning);
      if (!key || byKey.has(key)) return;

      if (detail) {
        byKey.set(key, detail);
        return;
      }

      const matched = (dataList || []).find((it) => {
        const vocab = normalizeText(it?.vocabulary || '');
        const viet = normalizeText(it?.vietnamMeaning || '');
        return vocab === key || viet === key;
      });
      if (matched) {
        byKey.set(key, matched);
        return;
      }

      byKey.set(key, {
        vocabulary: word || meaning || '—',
        vietnamMeaning: meaning || '',
        type: '',
        pronun: '',
        wordFamily: '',
        synonym: '',
        sentences: { en: '', vi: '' },
        learn: ''
      });
    });
    return Array.from(byKey.values());
  }, [reviewList, dataList]);

  const practiceDataList = useMemo(() => (
    practiceSource === 'review' ? reviewSourceData : (dataList || [])
  ), [practiceSource, reviewSourceData, dataList]);

  // regenerate random orders whenever the active practice data source changes
  useEffect(() => {
    const n = (practiceDataList && practiceDataList.length) || 0;
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
  }, [practiceDataList]);

  // quiz state
  const [quizState, setQuizState] = useState({
    'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
    'write-word': { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
    translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
    review: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 }
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

  const activeIndex = quizState[activeTab]?.index || 0;
  const translationIndex = quizState.translation?.index || 0;
  const writeWordIndex = quizState['write-word']?.index || 0;

  const currentQuestion = useMemo(() => {
    if (activeTab === 'translation') {
      return buildTranslationQuestion(translationIndex, translationData);
    }
    if (activeTab === 'write-word') {
      // map logical to randomized index same as other tabs
      const order = orders[activeTab] && orders[activeTab].length ? orders[activeTab] : null;
      const logicalIndex = writeWordIndex;
      const dataIndex = order ? order[logicalIndex % order.length] : logicalIndex;
      return buildWriteWordQuestion(practiceDataList, dataIndex);
    }
    // map logical quiz index to a randomized data index per tab (orders)
    const order = orders[activeTab] && orders[activeTab].length ? orders[activeTab] : null;
    const logicalIndex = activeIndex;
    const dataIndex = order ? order[logicalIndex % order.length] : logicalIndex;
    return buildChoiceQuestion(practiceDataList, activeTab, dataIndex);
  }, [activeTab, practiceDataList, orders, activeIndex, translationIndex, writeWordIndex]);

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
    const found = (practiceDataList || []).find((it) => {
      if (!it) return false;
      if (String(it.vocabulary || '') === optToMatch) return true;
      if (String(it.vietnamMeaning || '') === optToMatch) return true;
      if (norm(it.vocabulary) === targetNorm) return true;
      if (norm(it.vietnamMeaning) === targetNorm) return true;
      return false;
    });
    return found || currentQuestion.detail || null;
  }, [hoveredOption, currentQuestion, practiceDataList, activeTab, currentTabState]);
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

  const isCoarsePointerDevice = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
  };

  const getSelectionPayload = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const text = String(selection.toString() || '').trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text, rect };
  };

  const buildPopoverPlacement = (rect) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const coarse = isCoarsePointerDevice();

    if (coarse) {
      return {
        mode: 'sheet',
        placement: 'bottom',
        x: Math.round(viewportWidth / 2),
        y: Math.round(viewportHeight - 24)
      };
    }

    const estimatedWidth = Math.min(360, viewportWidth - 32);
    const x = Math.min(
      Math.max(rect.left + (rect.width / 2), 16 + (estimatedWidth / 2)),
      viewportWidth - 16 - (estimatedWidth / 2)
    );
    const canPlaceBelow = rect.bottom + 220 < viewportHeight;

    return {
      mode: 'floating',
      placement: canPlaceBelow ? 'below' : 'above',
      x: Math.round(x),
      y: Math.round(canPlaceBelow ? rect.bottom + 12 : Math.max(rect.top - 12, 16))
    };
  };

  const findLocalTranslation = (text) => {
    const normalized = normalizeText(text);
    if (!normalized) return null;

    const matched = (dataList || []).find((item) => {
      const vocabulary = normalizeText(item?.vocabulary || '');
      const meaning = normalizeText(item?.vietnamMeaning || '');
      const synonym = normalizeText(item?.synonym || '');
      return vocabulary === normalized || meaning === normalized || synonym === normalized;
    });

    if (!matched) return null;

    const sourceLang = translateConfig?.sourceLang || 'en';
    const targetLang = translateConfig?.targetLang || 'vi';
    const isToVietnamese = sourceLang.startsWith('en') && targetLang.startsWith('vi');
    const translatedText = isToVietnamese
      ? matched.vietnamMeaning || matched.learn || matched.synonym
      : matched.vocabulary || matched.synonym || matched.vietnamMeaning;

    if (!translatedText) return null;

    return {
      translatedText: String(translatedText),
      provider: 'local-vocab'
    };
  };

  const closeTranslatePopover = () => {
    if (translateAbortRef.current) {
      translateAbortRef.current.abort();
      translateAbortRef.current = null;
    }
    setTranslatePopover((prev) => ({ ...prev, open: false }));
  };

  const handleTranslateShortcut = async () => {
    const selectionPayload = getSelectionPayload();
    if (!selectionPayload) return;

    const { text, rect } = selectionPayload;
    const placement = buildPopoverPlacement(rect);
    const cacheKey = `${translateConfig?.sourceLang || 'en'}:${translateConfig?.targetLang || 'vi'}:${normalizeText(text)}`;
    const cached = translateCacheRef.current.get(cacheKey);

    setTranslatePopover({
      open: true,
      text,
      translatedText: cached?.translatedText || '',
      source: cached?.provider || '',
      loading: !cached,
      error: '',
      ...placement
    });

    if (cached) return;

    if (translateAbortRef.current) {
      translateAbortRef.current.abort();
    }

    const controller = new AbortController();
    translateAbortRef.current = controller;

    try {
      const apiResult = await requestTranslation({
        endpoint: translateConfig?.endpoint || '',
        text,
        sourceLang: translateConfig?.sourceLang || 'en',
        targetLang: translateConfig?.targetLang || 'vi',
        signal: controller.signal
      });

      translateCacheRef.current.set(cacheKey, apiResult);
      setTranslatePopover((prev) => ({
        ...prev,
        open: true,
        translatedText: apiResult.translatedText,
        source: apiResult.provider,
        loading: false,
        error: ''
      }));
    } catch (error) {
      if (controller.signal.aborted) return;

      const localResult = findLocalTranslation(text);
      if (localResult) {
        translateCacheRef.current.set(cacheKey, localResult);
        setTranslatePopover((prev) => ({
          ...prev,
          open: true,
          translatedText: localResult.translatedText,
          source: localResult.provider,
          loading: false,
          error: ''
        }));
        return;
      }

      setTranslatePopover((prev) => ({
        ...prev,
        open: true,
        translatedText: '',
        source: '',
        loading: false,
        error: translateConfig?.endpoint
          ? 'Khong the lay ban dich tu endpoint hien tai.'
          : 'Chua cau hinh endpoint dich. Hay them Translation API URL trong Settings.'
      }));
    } finally {
      if (translateAbortRef.current === controller) {
        translateAbortRef.current = null;
      }
    }
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

  const upsertReviewEntry = (entry) => {
    const detail = entry?.detail || null;
    const vocabulary = String(detail?.vocabulary || entry?.answer || entry?.word || '').trim();
    const meaning = String(detail?.vietnamMeaning || entry?.meaning || '').trim();
    const wordKey = normalizeText(vocabulary || meaning);
    if (!wordKey) return;

    setReviewList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const findKey = (it) => normalizeText(
        it?.word
        || it?.detail?.vocabulary
        || it?.answer
        || it?.detail?.vietnamMeaning
        || ''
      );
      const idx = list.findIndex((it) => findKey(it) === wordKey);
      const now = Date.now();
      const base = {
        id: wordKey,
        ts: now,
        word: vocabulary || meaning || '—',
        meaning,
        detail: detail || null,
        prompt: entry?.prompt || '',
        attempt: entry?.attempt || '',
        answer: entry?.answer || vocabulary || '',
        wrong: !!entry?.wrong,
        saved: !!entry?.saved
      };
      if (idx < 0) return [...list, base];

      const existing = list[idx] || {};
      const merged = {
        ...existing,
        ...base,
        ts: now,
        detail: base.detail || existing.detail || null,
        prompt: base.prompt || existing.prompt || '',
        attempt: base.attempt || existing.attempt || '',
        answer: base.answer || existing.answer || '',
        meaning: base.meaning || existing.meaning || '',
        wrong: !!(existing.wrong || base.wrong),
        saved: !!(existing.saved || base.saved)
      };

      const next = [...list];
      next[idx] = merged;
      return next;
    });
  };

  // selection behavior: immediate feedback; wrong disables that option; Next moves on (no auto-advance)
  const handleSelect = (option) => {
    if (activeTab === 'translation') return;
    if (currentTabState.checked) return;
    setHoveredOption(option);
    const shouldTrackWrongInReview = !(isPracticeTab && practiceSource === 'review');
 
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
      if (shouldTrackWrongInReview) {
        upsertReviewEntry({
          tab: activeTab,
          prompt: currentQuestion.prompt,
          attempt: option,
          answer: currentQuestion.answer,
          detail: currentQuestion.detail || null,
          wrong: true
        });
      }
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
    const input = currentTabState.input || '';
    const normalizedInput = normalizeText(input);
    const shouldTrackWrongInReview = !(isPracticeTab && practiceSource === 'review');
 
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
      if (!isCorrect && shouldTrackWrongInReview) {
        upsertReviewEntry({
          tab: activeTab,
          prompt: currentQuestion.prompt,
          attempt: input,
          answer: currentQuestion.answer,
          detail: currentQuestion.detail || null,
          wrong: true
        });
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
    if (!isCorrect && shouldTrackWrongInReview) {
      upsertReviewEntry({
        tab: activeTab,
        prompt: currentQuestion.prompt,
        attempt: input,
        answer: currentQuestion.answer,
        detail: currentQuestion.detail || null,
        wrong: true
      });
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
    // wrap / recycle when reaching list length
    if (activeTab === 'translation' || activeTab === 'write-word') {
      const len = activeTab === 'translation'
        ? (translationData && translationData.length) || 1
        : (practiceDataList && practiceDataList.length) || 1;
      const newIndex = (quizState[activeTab].index + 1) % len;
      updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '' });
      clearDisabledForIndex(activeTab, newIndex);
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (practiceDataList && practiceDataList.length) || 1;
    const newIndex = (currentTabState.index + 1) % len;
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '' });
    clearDisabledForIndex(activeTab, newIndex);
  };

  // keyboard: quick study shortcuts (skip when typing)
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

      if (key === 'ArrowRight') {
        if (isEditable) return;
        e.preventDefault();
        try { handleNext(); } catch (err) { /* ignore */ }
        return;
      }

      if (key === 'ArrowLeft') {
        if (isEditable) return;
        e.preventDefault();
        try { handlePrev(); } catch (err) { /* ignore */ }
        return;
      }

      if (['1', '2', '3', '4'].includes(key)) {
        if (isEditable) return;
        if (activeTab === 'translation' || activeTab === 'write-word' || activeTab === 'review') return;
        const idx = Number(key) - 1;
        const option = currentQuestion?.options?.[idx];
        if (!option) return;
        e.preventDefault();
        setHoveredOption(option);
        handleSelect(option);
        return;
      }

      if (key && key.toLowerCase() === 's') {
        if (isEditable) return;
        e.preventDefault();
        handleSaveCurrentWordToReview();
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

      if (key === 'Escape' && translatePopover.open) {
        e.preventDefault();
        closeTranslatePopover();
        return;
      }

      if (key && key.toLowerCase() === 'd') {
        if (isEditable) return;
        const selection = window.getSelection();
        const text = String(selection?.toString() || '').trim();
        if (!text) return;
        e.preventDefault();
        handleTranslateShortcut();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoverDetail, currentQuestion, activeTab, quizState, practiceDataList, orders, currentTabState, translatePopover.open, translateConfig]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!translatePopover.open) return;
      if (translatePopupRef.current && translatePopupRef.current.contains(event.target)) return;
      closeTranslatePopover();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [translatePopover.open]);

  useEffect(() => () => {
    if (translateAbortRef.current) {
      translateAbortRef.current.abort();
    }
    if (savedToastTimerRef.current) {
      clearTimeout(savedToastTimerRef.current);
    }
    if (sourceSlapTimerRef.current) {
      clearTimeout(sourceSlapTimerRef.current);
    }
  }, []);

  const handlePrev = () => {
    // wrap backwards
    if (activeTab === 'translation' || activeTab === 'write-word') {
      const len = activeTab === 'translation'
        ? (translationData && translationData.length) || 1
        : (practiceDataList && practiceDataList.length) || 1;
      const newIndex = (quizState[activeTab].index - 1 + len) % len;
      updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '' });
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (practiceDataList && practiceDataList.length) || 1;
    const newIndex = (currentTabState.index - 1 + len) % len;
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '' });
  };

  const handleReset = () => {
    if (activeTab === 'translation' || activeTab === 'write-word') {
      updateTabState(activeTab, { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 });
      setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
      return;
    }
    updateTabState(activeTab, { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 });
    setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
  };

  const handleSaveCurrentWordToReview = () => {
    const detail = hoverDetail || currentQuestion?.detail || null;
    if (!detail) return;
    upsertReviewEntry({
      tab: activeTab,
      prompt: currentQuestion?.prompt || '',
      answer: detail.vocabulary || '',
      detail,
      saved: true
    });
    setShowSavedToast(true);
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    savedToastTimerRef.current = setTimeout(() => {
      setShowSavedToast(false);
      savedToastTimerRef.current = null;
    }, 700);
  };

  const handleClearReview = () => {
    setReviewList([]);
  };

  const handleSwitchPracticeSource = (nextSource) => {
    if (nextSource === practiceSource) return;
    setPracticeSource(nextSource);
    setSourceSlapActive(true);
    if (sourceSlapTimerRef.current) clearTimeout(sourceSlapTimerRef.current);
    sourceSlapTimerRef.current = setTimeout(() => {
      setSourceSlapActive(false);
      sourceSlapTimerRef.current = null;
    }, 260);
    setHoveredOption(null);
    setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
    if (!isPracticeTab) return;

    if (activeTab === 'write-word') {
      updateTabState(activeTab, { index: 0, input: '', checked: false, feedback: '' });
      return;
    }
    updateTabState(activeTab, { index: 0, selected: '', checked: false, feedback: '' });
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
          translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
          review: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 }
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
            <p>
              Data source: <strong>{isPracticeTab ? (practiceSource === 'review' ? 'Review Data' : 'Original Data') : 'Default'}</strong>.
              {' '}Available words: {isPracticeTab ? (practiceDataList?.length || 0) : (dataList?.length || 0)}.
            </p>
            {isPracticeTab && practiceSource === 'review' ? (
              <p>Hãy lưu từ sai hoặc bấm Save để thêm từ vào Review trước khi luyện theo nguồn Review.</p>
            ) : (
              <p>Use Settings to load a sheet or check mapping.</p>
            )}
          </section>
        </main>
      </div>
    );
  }

  const indexKey = quizState[activeTab].index;
  const tabDisabledEntry = (disabledMap[activeTab] || {})[indexKey] || { disabledOptions: [], lockAll: false };
  const disabledOptionsForCurrent = new Set(tabDisabledEntry.disabledOptions || []);
  const lockAllForCurrent = !!tabDisabledEntry.lockAll;
  const shouldRevealMixedPrompt = activeTab === 'mixed'
    && !!currentTabState.checked
    && currentTabState.selected === currentQuestion?.answer;

  const renderPromptText = () => {
    const rawPrompt = currentQuestion?.prompt || '';
    if (!shouldRevealMixedPrompt) return rawPrompt;

    const sourceSentence = String(
      currentQuestion?.fullSentence
      || currentQuestion?.detail?.sentences?.en
      || ''
    );
    const rebuiltSentence = sourceSentence || rawPrompt.replace('____', currentQuestion?.answer || '');
    if (!rebuiltSentence) return rawPrompt;

    const token = String(currentQuestion?.blankedToken || currentQuestion?.answer || '').trim();
    if (!token) return rebuiltSentence;

    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    const match = rebuiltSentence.match(tokenRegex);
    if (!match || typeof match.index !== 'number') return rebuiltSentence;

    const start = match.index;
    const end = start + match[0].length;
    return (
      <>
        {rebuiltSentence.slice(0, start)}
        <strong className="prompt-answer-highlight">{rebuiltSentence.slice(start, end)}</strong>
        {rebuiltSentence.slice(end)}
      </>
    );
  };

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

  const currentWordDetail = hoverDetail || currentQuestion?.detail || null;
  const canSaveCurrentWord = !!(currentWordDetail?.vocabulary || currentWordDetail?.vietnamMeaning);
  const reviewItems = [...(reviewList || [])].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));

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

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
              <h4>Translation Popup</h4>
              <div style={{ display: 'grid', gap: 10 }}>
                <input
                  placeholder="Translation API URL"
                  value={translateConfig.endpoint}
                  onChange={(e) => setTranslateConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ flex: 1 }}
                    placeholder="Source lang"
                    value={translateConfig.sourceLang}
                    onChange={(e) => setTranslateConfig((prev) => ({ ...prev, sourceLang: e.target.value || 'en' }))}
                  />
                  <input
                    style={{ flex: 1 }}
                    placeholder="Target lang"
                    value={translateConfig.targetLang}
                    onChange={(e) => setTranslateConfig((prev) => ({ ...prev, targetLang: e.target.value || 'vi' }))}
                  />
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#557261' }}>
                  Nhan <strong>d</strong> sau khi boi den text de mo popup dich. De test tren mobile va may khac, nen dung mot translation endpoint co the truy cap qua LAN hoac domain thay vi chi tro vao localhost.
                </p>
              </div>
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
              <div>
                <span className="chip">
                  {activeTab === 'translation' ? 'Viết tự do' : activeTab === 'review' ? 'Review' : 'Multiple Choice'}
                </span>
                <h2>
                  {activeTab === 'translation' ? 'Hiển thị câu và viết lại'
                    : activeTab === 'review' ? `Review (${(reviewList || []).length})`
                    : currentQuestion?.title}
                </h2>
              </div>
              {isPracticeTab && (
                <button
                  type="button"
                  className={`source-switch slap ${practiceSource === 'review' ? 'is-rev' : 'is-org'} ${sourceSlapActive ? 'is-slapping' : ''}`}
                  onClick={() => handleSwitchPracticeSource(practiceSource === 'review' ? 'all' : 'review')}
                  title={`Switch source (Review items: ${reviewItems.length})`}
                  aria-label="Switch source Org/Rev"
                >
                  <span className="source-option org">Org</span>
                  <span className="source-option rev">Rev</span>
                  <span className="source-knob" />
                </button>
              )}
             </div>
            {activeTab === 'review' ? (
              <div className="review-panel">
                <div className="actions" style={{ marginBottom: 12 }}>
                  <button className="ghost-button" onClick={handleClearReview} disabled={!reviewItems.length}>Clear</button>
                </div>

                {reviewItems.length ? (
                  <div className="review-list">
                    {reviewItems.map((item) => {
                      const displayWord = item.word || item.detail?.vocabulary || item.answer || item.detail?.vietnamMeaning || '—';
                      const displayMeaning = item.meaning || item.detail?.vietnamMeaning || '—';
                      const sentenceExample = item.detail?.sentences?.en || item.detail?.sentences?.vi || '—';
                      const sentenceExplain = item.detail?.sentences?.vi || item.detail?.sentences?.en || '—';
                      const learnText = item.detail?.learn || '—';
                      return (
                        <div key={item.id || `${displayWord}-${item.ts || 0}`} className="review-item">
                          <p><strong>{displayWord}</strong> <span style={{ color: '#5b7c68' }}>({displayMeaning})</span></p>
                          <p className="review-meta">Sentence: {sentenceExample} / {sentenceExplain}</p>
                          <p className="review-meta">Learn: {learnText}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="data-structure">
                    <p style={{ margin: 0 }}>Review list is empty.</p>
                    <p style={{ marginTop: 6, fontSize: 13, color: '#666' }}>
                      Các từ bạn làm sai hoặc bấm Save ở side card sẽ xuất hiện ở đây.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  className="prompt-box"
                  onMouseEnter={() => {
                    const questionTarget = currentQuestion?.detail?.vocabulary || currentQuestion?.detail?.vietnamMeaning || null;
                    if (questionTarget) setHoveredOption(questionTarget);
                  }}
                  onTouchStart={() => {
                    const questionTarget = currentQuestion?.detail?.vocabulary || currentQuestion?.detail?.vietnamMeaning || null;
                    if (questionTarget) setHoveredOption(questionTarget);
                  }}
                >
                  <span className="prompt-label">
                    {activeTab === 'translation' ? 'Đề bài' : 'Câu hỏi'}
                  </span>
                  <p>{renderPromptText()}</p>
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
                       let stateClass = '';
                       if (lockAllForCurrent && option === currentQuestion.answer) {
                         stateClass = 'correct';
                       } else if (isDisabledOption) {
                         stateClass = 'wrong';
                       } else if (currentTabState.selected === option) {
                         stateClass = 'selected';
                       }
                       const className = `option-button ${stateClass}`.trim();
                       const handleOptionMouseEnter = (opt) => {
                         if (Date.now() < ignoreHoverUntilRef.current) return;
                         setHoveredOption(opt);
                       };
                       return (
                         <div
                           key={`${currentQuestion.id}-opt-wrap-${idx}`}
                           className="option-hitbox"
                           onMouseEnter={() => handleOptionMouseEnter(option)}
                           onTouchStart={() => handleOptionMouseEnter(option)}
                         >
                           <button
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
                  <button className="secondary-button" onClick={handleNext}>Next →</button>
                  <button className="ghost-button" onClick={handleReset}>Reset</button>
                </div>

                <div className="data-structure learn-panel">
                  <span className="info-label">Learn column (for current word)</span>
                  {hoverDetail ? (
                    <div>
                      {hoverDetail.learn ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{String(hoverDetail.learn)}</div>
                      ) : (
                        <>
                          <p style={{ margin: 0 }}>No "Learn" data for this word.</p>
                          <p style={{ marginTop: 6, fontSize: 13, color: '#666' }}>
                            Current: <strong>{hoverDetail.vocabulary || hoverDetail.vietnamMeaning || '—'}</strong>
                          </p>
                        </>
                      )}
                    </div>
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
              </>
            )}
          </article>

          <aside className="side-card">
            <SideCard
              activeTab={activeTab}
              hoverDetail={hoverDetail}
              speak={(text, lang) => speak(text, lang)}
              onSaveCurrentWord={handleSaveCurrentWordToReview}
              canSaveCurrentWord={canSaveCurrentWord}
            />
          </aside>
        </section>
      </main>

      {translatePopover.open && (
        <div
          ref={translatePopupRef}
          className={`translate-popover ${translatePopover.mode === 'sheet' ? 'sheet' : translatePopover.placement}`}
          style={translatePopover.mode === 'sheet'
            ? undefined
            : {
                left: `${translatePopover.x}px`,
                top: `${translatePopover.y}px`
              }}
        >
          <div className="translate-popover-header">
            <span className="chip secondary">Quick Translate</span>
            <button type="button" className="ghost-button translate-close" onClick={closeTranslatePopover}>Close</button>
          </div>
          <div className="translate-popover-body">
            <p className="translate-selection">{translatePopover.text}</p>
            {translatePopover.loading ? (
              <p className="translate-muted">Dang dich...</p>
            ) : translatePopover.error ? (
              <p className="translate-error">{translatePopover.error}</p>
            ) : (
              <>
                <p className="translate-result">{translatePopover.translatedText || 'Khong co ket qua.'}</p>
                <p className="translate-muted">
                  Nguon: {translatePopover.source || 'unknown'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <div className={`saved-toast ${showSavedToast ? 'show' : ''}`}>Saved</div>
    </div>
  );
}
