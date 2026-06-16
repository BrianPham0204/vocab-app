import React, { useState, useMemo, useEffect, useRef } from 'react';
import { vocabularyData as localVocabularyData } from './data/mockData';
import './App.css';
import { convertSheetUrlToCsv, fetchCsvAsText, parseCSV, mapSheetRowsToData } from './utils/sheet';
import { useLocalStorage } from './hooks/useLocalStorage';
import SideCard from './components/SideCard';
import { buildChoiceQuestion, buildWriteWordQuestion, normalizeText } from './utils/questions';
import { requestTranslation } from './utils/translate';

const groupedTabs = [
  { id: 'mcq', label: 'Multiple Choice' },
  { id: 'writing', label: 'Writing' },
  { id: 'library', label: 'Review & Log' }
];
const mcqModes = [
  { id: 'en-to-vi', label: 'EN → VN' },
  { id: 'vi-to-en', label: 'VN → EN' },
  { id: 'mixed', label: 'Cloze' }
];
const mcqPracticeTabs = ['en-to-vi', 'vi-to-en', 'mixed'];
const writingModes = [
  { id: 'write-word', label: 'Viết lại từ' },
  { id: 'translation', label: 'Viết lại câu' }
];
const libraryModes = [
  { id: 'review', label: 'Review' },
  { id: 'writing-log', label: 'Writing Log' }
];
const practiceTabs = ['en-to-vi', 'vi-to-en', 'mixed', 'write-word', 'translation'];
const SCHEMA_FIELDS = [
  { key: 'vocabulary', label: 'Vocabulary', hint: 'Tu vung chinh' },
  { key: 'cat', label: 'CAT', hint: 'Nhom / loai de loc vocab' },
  { key: 'type', label: 'Type', hint: 'Tu loai' },
  { key: 'pronun', label: 'Pronunciation', hint: 'Phat am / phonetic' },
  { key: 'vietnamMeaning', label: 'Meaning', hint: 'Nghia tieng Viet' },
  { key: 'wordFamily', label: 'Word family', hint: 'Ho tu' },
  { key: 'synonym', label: 'Synonym', hint: 'Dong nghia' },
  { key: 'collocation', label: 'Collocation', hint: 'Cum tu di kem' },
  { key: 'pattern', label: 'Pattern', hint: 'Cau truc / PARTERN' },
  { key: 'sentences_en', label: 'Example EN', hint: 'Vi du tieng Anh' },
  { key: 'sentences_vi', label: 'Example VI', hint: 'Vi du tieng Viet' },
  { key: 'learn', label: 'Learn', hint: 'Ghi chu hoc tap' }
];
const MAPPING_SUGGESTERS = {
  vocabulary: [/vocab|vocabulary/i],
  cat: [/^cat$/i, /category|group|tag/i],
  type: [/type|pos|class/i],
  pronun: [/pronun|pronounce|phonetic|pron/i],
  vietnamMeaning: [/meaning|viet|vietnam/i],
  wordFamily: [/word ?family|family/i],
  synonym: [/synonym|syn/i],
  collocation: [/collocation|collocate|collo/i],
  pattern: [/pattern|partern|structure|form/i],
  sentences_en: [/^example$/i, /sentence|example.*en|en_sentence|sentences_en/i],
  sentences_vi: [/^translate$/i, /^translation$/i, /sentence.*vi|vi_sentence|sentences_vi|translate/i],
  learn: [/learn/i]
};

const createHeaderFinder = (headers) => (candidates) => {
  if (!headers || headers.length === 0) return '';

  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const found = createHeaderFinder(headers)(candidate);
      if (found) return found;
    }
    return '';
  }

  const re = typeof candidates === 'string' ? new RegExp(candidates, 'i') : candidates;
  return headers.find((header) => re.test(header)) || '';
};

const resolveMappingForHeaders = (headers, previousMapping = {}) => {
  const headerList = Array.isArray(headers) ? headers : [];
  const findHeader = createHeaderFinder(headerList);
  const hasHeader = (value) => headerList.some((header) => String(header).trim().toLowerCase() === String(value || '').trim().toLowerCase());

  return {
    vocabulary: hasHeader(previousMapping.vocabulary) ? previousMapping.vocabulary : (findHeader(MAPPING_SUGGESTERS.vocabulary) || headerList[0] || ''),
    cat: hasHeader(previousMapping.cat) ? previousMapping.cat : findHeader(MAPPING_SUGGESTERS.cat),
    type: hasHeader(previousMapping.type) ? previousMapping.type : findHeader(MAPPING_SUGGESTERS.type),
    pronun: hasHeader(previousMapping.pronun) ? previousMapping.pronun : findHeader(MAPPING_SUGGESTERS.pronun),
    vietnamMeaning: hasHeader(previousMapping.vietnamMeaning) ? previousMapping.vietnamMeaning : findHeader(MAPPING_SUGGESTERS.vietnamMeaning),
    wordFamily: hasHeader(previousMapping.wordFamily) ? previousMapping.wordFamily : findHeader(MAPPING_SUGGESTERS.wordFamily),
    synonym: hasHeader(previousMapping.synonym) ? previousMapping.synonym : findHeader(MAPPING_SUGGESTERS.synonym),
    collocation: hasHeader(previousMapping.collocation) ? previousMapping.collocation : findHeader(MAPPING_SUGGESTERS.collocation),
    pattern: hasHeader(previousMapping.pattern) ? previousMapping.pattern : findHeader(MAPPING_SUGGESTERS.pattern),
    sentences_en: hasHeader(previousMapping.sentences_en) ? previousMapping.sentences_en : findHeader(MAPPING_SUGGESTERS.sentences_en),
    sentences_vi: hasHeader(previousMapping.sentences_vi) ? previousMapping.sentences_vi : findHeader(MAPPING_SUGGESTERS.sentences_vi),
    learn: hasHeader(previousMapping.learn) ? previousMapping.learn : findHeader(MAPPING_SUGGESTERS.learn)
  };
};

const CATEGORY_ALL = 'ALL';
const CATEGORY_WAIT = 'WAIT';
const ALLOWED_CATEGORY_VALUES = ['ACT', 'THG', 'ENV', 'GEN', 'LIF', 'LEV', 'PHR', 'STR'];

const resolveCategoryLabel = (item) => {
  const rawValue = String(item?.cat || '').trim().toUpperCase();
  if (!rawValue) return CATEGORY_WAIT;
  return ALLOWED_CATEGORY_VALUES.includes(rawValue) ? rawValue : CATEGORY_WAIT;
};

const buildCategoryOptions = () => [CATEGORY_ALL, ...ALLOWED_CATEGORY_VALUES, CATEGORY_WAIT];

const normalizeSelectedCategories = (value) => {
  const rawList = Array.isArray(value) ? value : [value];
  const normalized = rawList
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);

  if (!normalized.length || normalized.includes(CATEGORY_ALL)) {
    return [CATEGORY_ALL];
  }

  const allowed = new Set(buildCategoryOptions());
  const unique = Array.from(new Set(normalized.filter((item) => allowed.has(item) && item !== CATEGORY_ALL)));
  return unique.length ? unique : [CATEGORY_ALL];
};

const buildRandomOrderIndexes = (count) => {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const clampPositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const createDefaultOrders = () => ({
  'en-to-vi': [],
  'vi-to-en': [],
  mixed: [],
  'write-word': []
});

const createDefaultQuizState = () => ({
  'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  'write-word': { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  review: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null },
  'writing-log': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null }
});

const createDefaultDisabledMap = () => ({});

const sanitizeIndex = (value, max) => {
  const parsed = Number.isFinite(value) ? value : Number.parseInt(String(value || '0'), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  if (typeof max !== 'number' || max < 0) return Math.max(0, parsed);
  return Math.min(parsed, max);
};

const isPermutationOrder = (order, count) => {
  if (!Array.isArray(order) || order.length !== count) return false;
  const unique = new Set(order);
  if (unique.size !== count) return false;
  return order.every((value) => Number.isInteger(value) && value >= 0 && value < count);
};

const buildWriteWordFeedback = (question) => {
  const answer = String(question?.answer || '').trim();
  const synonym = String(question?.detail?.synonym || '').trim();
  return [answer, synonym].filter(Boolean).join(' / ') || answer || '—';
};

const resolveWordOrder = (item, fallbackIndex) => {
  const explicitOrder = clampPositiveInteger(item?.order ?? item?.stt ?? item?._rowNumber);
  return explicitOrder || (fallbackIndex + 1);
};

const attachWordOrder = (list) => (
  (Array.isArray(list) ? list : []).map((item, index) => ({
    ...item,
    _rowNumber: resolveWordOrder(item, index)
  }))
);

export default function App() {
  // persisted settings and data
  const [sheetUrl, setSheetUrl] = useLocalStorage('vocab_sheet_url', '');
  const [mapping, setMapping] = useLocalStorage('vocab_mapping', {
    vocabulary: '',
    cat: '',
    type: '',
    pronun: '',
    vietnamMeaning: '',
    wordFamily: '',
    synonym: '',
    collocation: '',
    pattern: '',
    sentences_en: '',
    sentences_vi: '',
    learn: ''
  });
  const [dataList, setDataList] = useLocalStorage('vocab_data', localVocabularyData || []);
  const [wordRange, setWordRange] = useLocalStorage('vocab_word_range', { start: '', end: '' });
  // review list (wrong answers)
  const [reviewList, setReviewList] = useLocalStorage('vocab_review', []);
  const [writingLogList, setWritingLogList] = useLocalStorage('vocab_writing_log', []);

  // UI state
  const [activeGroup, setActiveGroup] = useLocalStorage('vocab_active_group', 'mcq');
  const [mcqMode, setMcqMode] = useLocalStorage('vocab_mcq_mode', 'en-to-vi');
  const [writingMode, setWritingMode] = useLocalStorage('vocab_writing_mode', 'write-word');
  const [libraryMode, setLibraryMode] = useLocalStorage('vocab_library_mode', 'review');
  const [practiceSource, setPracticeSource] = useLocalStorage('vocab_practice_source', 'all');
  const [selectedCategories, setSelectedCategories] = useLocalStorage('vocab_selected_category', [CATEGORY_ALL]);
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [sheetPreviewRows, setSheetPreviewRows] = useState([]);
  // persistent voice toggle (shortcut 'v')
  const [voiceEnabled, setVoiceEnabled] = useLocalStorage('vocab_voice_enabled', false);
  const [draggingHeader, setDraggingHeader] = useState(null);
  const [dropHover, setDropHover] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translateConfig, setTranslateConfig] = useLocalStorage('vocab_translate_config', {
    endpoint: import.meta.env.VITE_TRANSLATE_API_URL || '/api/translate',
    sourceLang: 'en',
    targetLang: 'vi'
  });

  // random order per tab so words show randomly
  const [orders, setOrders] = useLocalStorage('vocab_orders', createDefaultOrders());
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
  const [translationWordCount, setTranslationWordCount] = useState(5);
  const [translationWords, setTranslationWords] = useState([]);
  const [pendingReviewRemoval, setPendingReviewRemoval] = useState(null);
  const [quizState, setQuizState] = useLocalStorage('vocab_quiz_state', createDefaultQuizState());
  const [disabledMap, setDisabledMap] = useLocalStorage('vocab_disabled_map', createDefaultDisabledMap());
  const normalizedDataList = useMemo(() => attachWordOrder(dataList), [dataList]);
  const rawRangeStart = clampPositiveInteger(wordRange?.start);
  const rawRangeEnd = clampPositiveInteger(wordRange?.end);
  const hasWordRange = rawRangeStart !== null || rawRangeEnd !== null;
  const rangeStart = rawRangeStart !== null && rawRangeEnd !== null
    ? Math.min(rawRangeStart, rawRangeEnd)
    : rawRangeStart;
  const rangeEnd = rawRangeStart !== null && rawRangeEnd !== null
    ? Math.max(rawRangeStart, rawRangeEnd)
    : rawRangeEnd;
  const effectiveRangeStart = rangeStart ?? 1;
  const effectiveRangeEnd = rangeEnd ?? Number.MAX_SAFE_INTEGER;
  const activeTab = useMemo(() => {
    if (activeGroup === 'mcq') return mcqMode;
    if (activeGroup === 'writing') return writingMode;
    return libraryMode;
  }, [activeGroup, mcqMode, writingMode, libraryMode]);
  const isPracticeTab = practiceTabs.includes(activeTab);
  // suppress hover immediately after question change (prevents remount-triggered onMouseEnter)
  const ignoreHoverUntilRef = useRef(0);
  const mappingRef = useRef(mapping);
  const translateAbortRef = useRef(null);
  const translateCacheRef = useRef(new Map());
  const translatePopupRef = useRef(null);
  const savedToastTimerRef = useRef(null);
  const sourceSlapTimerRef = useRef(null);
  const lastAppliedRangeRef = useRef(null);
  const writeWordInputRef = useRef(null);
  const shouldRefocusWriteWordRef = useRef(false);
  const shouldAutoSpeakNextRef = useRef(false);
  
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

      const matched = normalizedDataList.find((it) => {
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
          cat: '',
          vietnamMeaning: meaning || '',
          _rowNumber: null,
          type: '',
          pronun: '',
          wordFamily: '',
          synonym: '',
          collocation: '',
          pattern: '',
          sentences: { en: '', vi: '' },
          learn: ''
        });
    });
    return Array.from(byKey.values());
  }, [reviewList, normalizedDataList]);

  useEffect(() => {
    mappingRef.current = mapping;
  }, [mapping]);

  const categoryOptions = useMemo(() => buildCategoryOptions(), []);
  const normalizedSelectedCategories = useMemo(
    () => normalizeSelectedCategories(selectedCategories),
    [selectedCategories]
  );
  const isAllCategoriesSelected = normalizedSelectedCategories.includes(CATEGORY_ALL);

  useEffect(() => {
    const nextCategories = normalizeSelectedCategories(selectedCategories);
    const hasChanged = JSON.stringify(nextCategories) !== JSON.stringify(selectedCategories);
    if (hasChanged) {
      setSelectedCategories(nextCategories);
    }
  }, [categoryOptions, selectedCategories, setSelectedCategories]);

  const toggleCategory = (category) => {
    setSelectedCategories((prev) => {
      const current = normalizeSelectedCategories(prev);
      if (category === CATEGORY_ALL) {
        return [CATEGORY_ALL];
      }

      const next = current.includes(CATEGORY_ALL)
        ? [category]
        : current.includes(category)
          ? current.filter((item) => item !== category)
          : [...current, category];

      return normalizeSelectedCategories(next);
    });
  };

  const filteredVocabularyData = useMemo(() => (
    normalizedDataList.filter((item) => {
      const rowNumber = resolveWordOrder(item, 0);
      const matchedCategory = isAllCategoriesSelected || normalizedSelectedCategories.includes(resolveCategoryLabel(item));
      return rowNumber >= effectiveRangeStart && rowNumber <= effectiveRangeEnd && matchedCategory;
    })
  ), [normalizedDataList, effectiveRangeStart, effectiveRangeEnd, isAllCategoriesSelected, normalizedSelectedCategories]);

  const filteredReviewData = useMemo(() => (
    reviewSourceData.filter((item) => {
      const rowNumber = clampPositiveInteger(item?._rowNumber);
      const matchedCategory = isAllCategoriesSelected || normalizedSelectedCategories.includes(resolveCategoryLabel(item));
      if (rowNumber === null) return !hasWordRange && matchedCategory;
      return rowNumber >= effectiveRangeStart && rowNumber <= effectiveRangeEnd && matchedCategory;
    })
  ), [reviewSourceData, hasWordRange, effectiveRangeStart, effectiveRangeEnd, isAllCategoriesSelected, normalizedSelectedCategories]);

  const practiceDataList = useMemo(() => (
    practiceSource === 'review' ? filteredReviewData : filteredVocabularyData
  ), [practiceSource, filteredReviewData, filteredVocabularyData]);

  useEffect(() => {
    if (!isPracticeTab || practiceSource !== 'review' || reviewSourceData.length > 0) {
      return;
    }

    setPracticeSource('all');
    setPendingReviewRemoval(null);
    setHoveredOption(null);
    setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
    updateTabState(activeTab, (activeTab === 'write-word' || activeTab === 'translation')
      ? { index: 0, input: '', checked: false, feedback: '' }
      : { index: 0, selected: '', checked: false, feedback: '' });
    if (activeTab === 'translation') {
      setTranslationWords([]);
    }
  }, [activeTab, isPracticeTab, practiceSource, reviewSourceData.length]);

  const pickRandomVocabularyWords = (count) => {
    const pool = practiceDataList
      .map((it) => String(it?.vocabulary || '').trim())
      .filter(Boolean);
    const uniquePool = Array.from(new Set(pool));
    if (!uniquePool.length) return [];
    const safeCount = Math.max(1, Math.min(Number(count) || 1, uniquePool.length || 1));
    const shuffled = [...uniquePool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, safeCount);
  };

  const refreshTranslationWords = (requestedCount = translationWordCount) => {
    const words = pickRandomVocabularyWords(requestedCount);
    setTranslationWords(words);
    updateTabState('translation', { input: '', checked: false, feedback: '' });
  };

  useEffect(() => {
    if (activeTab === 'translation' && !translationWords.length && practiceDataList.length) {
      setTranslationWords(pickRandomVocabularyWords(translationWordCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, practiceDataList, practiceSource]);

  // keep persisted quiz progress compatible with the current dataset/filter
  useEffect(() => {
    const practiceCount = Array.isArray(practiceDataList) ? practiceDataList.length : 0;

    setOrders((prev) => {
      const next = { ...createDefaultOrders(), ...(prev || {}) };
      let changed = false;

      Object.keys(createDefaultOrders()).forEach((tabId) => {
        const existing = next[tabId];
        if (!isPermutationOrder(existing, practiceCount)) {
          next[tabId] = practiceCount ? buildRandomOrderIndexes(practiceCount) : [];
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    setQuizState((prev) => {
      const next = { ...createDefaultQuizState(), ...(prev || {}) };
      let changed = false;
      const mcqMax = practiceCount;
      const writeWordMax = Math.max(practiceCount - 1, 0);

      mcqPracticeTabs.forEach((tabId) => {
        const current = next[tabId] || createDefaultQuizState()[tabId];
        const sanitizedIndex = sanitizeIndex(current.index, mcqMax);
        if (current.index !== sanitizedIndex) {
          next[tabId] = { ...current, index: sanitizedIndex };
          changed = true;
        }
      });

      const writeWordState = next['write-word'] || createDefaultQuizState()['write-word'];
      const sanitizedWriteWordIndex = sanitizeIndex(writeWordState.index, writeWordMax);
      if (writeWordState.index !== sanitizedWriteWordIndex) {
        next['write-word'] = { ...writeWordState, index: sanitizedWriteWordIndex };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [practiceDataList, setOrders, setQuizState]);

  useEffect(() => {
    const nextRangeKey = `${effectiveRangeStart}:${effectiveRangeEnd}:${normalizedSelectedCategories.join('|')}`;
    if (lastAppliedRangeRef.current === null) {
      lastAppliedRangeRef.current = nextRangeKey;
      return;
    }
    if (lastAppliedRangeRef.current === nextRangeKey) {
      return;
    }
    lastAppliedRangeRef.current = nextRangeKey;
    setPendingReviewRemoval(null);
    setHoveredOption(null);
    setDisabledMap({});
    setQuizState((prev) => ({
      ...prev,
      'en-to-vi': { ...prev['en-to-vi'], index: 0, selected: '', checked: false, feedback: '' },
      'vi-to-en': { ...prev['vi-to-en'], index: 0, selected: '', checked: false, feedback: '' },
      mixed: { ...prev.mixed, index: 0, selected: '', checked: false, feedback: '' },
      'write-word': { ...prev['write-word'], index: 0, input: '', checked: false, feedback: '' },
      translation: { ...prev.translation, input: '', checked: false, feedback: '' },
      review: { ...prev.review, index: 0, selected: '', checked: false, feedback: '' }
    }));
    setTranslationWords([]);
  }, [effectiveRangeStart, effectiveRangeEnd, normalizedSelectedCategories]);

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
        setMapping((m) => {
          const next = resolveMappingForHeaders(headers, m);
          mappingRef.current = next;
          return next;
        });
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
  const writeWordIndex = quizState['write-word']?.index || 0;

  const currentQuestion = useMemo(() => {
    if (activeTab === 'translation') {
      const words = translationWords.length ? translationWords : pickRandomVocabularyWords(translationWordCount);
      return {
        id: `translation-writing-${words.join('|')}`,
        title: 'Viết đoạn văn theo từ gợi ý',
        prompt: 'Viết đoạn văn sử dụng các từ gợi ý.',
        answer: '',
        options: [],
        detail: null
      };
    }
    if (activeTab === 'writing-log') {
      return null;
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
    if (mcqPracticeTabs.includes(activeTab) && order && logicalIndex >= order.length) {
      return null;
    }
    const dataIndex = order ? order[logicalIndex] : logicalIndex;
    return buildChoiceQuestion(practiceDataList, activeTab, dataIndex);
  }, [activeTab, practiceDataList, orders, activeIndex, writeWordIndex, translationWords, translationWordCount]);

  const currentTabState = quizState[activeTab];
  const isMcqTab = mcqPracticeTabs.includes(activeTab);
  const activeOrderLength = (orders[activeTab] && orders[activeTab].length) || 0;
  const isMcqLibraryComplete = isMcqTab && activeOrderLength > 0 && activeIndex >= activeOrderLength;
  const modeAvailability = useMemo(() => {
    const list = Array.isArray(practiceDataList) ? practiceDataList : [];
    const hasText = (value) => !!String(value || '').trim();

    return {
      total: list.length,
      enToVi: list.filter((item) => hasText(item?.vocabulary) && hasText(item?.vietnamMeaning)).length,
      viToEn: list.filter((item) => hasText(item?.vocabulary) && hasText(item?.vietnamMeaning)).length,
      mixed: list.filter((item) => hasText(item?.vocabulary) && hasText(item?.sentences?.en)).length,
      writeWord: list.filter((item) => hasText(item?.vocabulary) && hasText(item?.vietnamMeaning)).length
    };
  }, [practiceDataList]);
  const learnedCount = isMcqTab
    ? Math.min(activeIndex + (currentTabState?.checked ? 1 : 0), activeOrderLength)
    : 0;
  const remainCount = isMcqTab
    ? Math.max(activeOrderLength - learnedCount, 0)
    : 0;

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
    const detailLookupData = activeTab === 'translation' ? filteredVocabularyData : (practiceDataList || []);
    const found = detailLookupData.find((it) => {
      if (!it) return false;
      if (String(it.vocabulary || '') === optToMatch) return true;
      if (String(it.vietnamMeaning || '') === optToMatch) return true;
      if (norm(it.vocabulary) === targetNorm) return true;
      if (norm(it.vietnamMeaning) === targetNorm) return true;
      return false;
    });
    return found || currentQuestion.detail || null;
  }, [hoveredOption, currentQuestion, practiceDataList, filteredVocabularyData, activeTab, currentTabState]);
  // clear hover when question changes (keeps default first option)
  useEffect(() => {
    // do NOT clear hoveredOption here — keep last mouse-pointed vocab across navigation
    // only suppress immediate onMouseEnter events from remounted buttons
    ignoreHoverUntilRef.current = Date.now() + 300;
  }, [currentQuestion?.id]);

  useEffect(() => {
    if (activeTab !== 'write-word' || !shouldRefocusWriteWordRef.current) return;

    shouldRefocusWriteWordRef.current = false;
    const focusTarget = () => {
      const el = writeWordInputRef.current;
      if (!el) return;
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      const valueLength = String(el.value || '').length;
      try {
        el.setSelectionRange(valueLength, valueLength);
      } catch {
        // ignore selection API issues on some mobile browsers
      }
    };

    const frame = window.requestAnimationFrame(focusTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, currentQuestion?.id]);
  
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

    const matched = normalizedDataList.find((item) => {
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

  const updateWordRangeField = (field, value) => {
    const digitsOnly = String(value || '').replace(/[^\d]/g, '');
    setWordRange((prev) => ({ ...(prev || {}), [field]: digitsOnly }));
  };

  const clearWordRange = () => {
    setWordRange({ start: '', end: '' });
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
    setMapping((m) => {
      const next = { ...m, [field]: hdr };
      mappingRef.current = next;
      return next;
    });
    setDraggingHeader(null);
    setDropHover(null);
  };
  const clearMappingField = (field) => setMapping((m) => {
    const next = { ...m, [field]: '' };
    mappingRef.current = next;
    return next;
  });

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

  const detectSpeechLang = (text) => {
    const value = String(text || '');
    if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(value)) {
      return 'vi-VN';
    }
    return 'en-US';
  };

  const getSelectedTextFromTarget = (target) => {
    const tag = target && target.tagName && String(target.tagName).toLowerCase();
    const canHaveSelection = tag === 'textarea'
      || (tag === 'input' && ['text', 'search', 'url', 'email', 'tel', 'password'].includes(String(target.type || 'text').toLowerCase()));

    if (canHaveSelection && typeof target.selectionStart === 'number' && typeof target.selectionEnd === 'number') {
      const selected = String(target.value || '').slice(target.selectionStart, target.selectionEnd).trim();
      if (selected) return selected;
    }

    const selection = window.getSelection();
    return String(selection?.toString() || '').trim();
  };

  const toggleVoiceEnabled = () => {
    setVoiceEnabled((prev) => !prev);
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

  const removeReviewEntry = (entryLike) => {
    const detail = entryLike?.detail || null;
    const keys = [
      detail?.vocabulary,
      detail?.vietnamMeaning,
      entryLike?.answer,
      entryLike?.word
    ]
      .map((v) => normalizeText(String(v || '').trim()))
      .filter(Boolean);
    if (!keys.length) return;

    setReviewList((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const findKey = (it) => normalizeText(
        it?.word
        || it?.detail?.vocabulary
        || it?.answer
        || it?.detail?.vietnamMeaning
        || ''
      );
      return list.filter((it) => !keys.includes(findKey(it)));
    });
  };

  // selection behavior: immediate feedback; wrong disables that option; Next moves on (no auto-advance)
  const handleSelect = (option) => {
    if (activeTab === 'translation') return;
    if (currentTabState.checked) return;
    setHoveredOption(option);
    const shouldTrackWrongInReview = !(isPracticeTab && practiceSource === 'review');
    const shouldRemoveWhenCorrectInReview = isPracticeTab && practiceSource === 'review';
 
    const idx = quizState[activeTab].index;
    const isCorrect = option === currentQuestion.answer;
 
    if (isCorrect) {
      updateTabState(activeTab, {
        selected: option,
        checked: true,
        feedback: 'Chính xác.',
        score: currentTabState.score + 1,
        answered: currentTabState.answered + 1,
        lastResultCorrect: true
      });
      if (shouldRemoveWhenCorrectInReview) {
        setPendingReviewRemoval({
          tabId: activeTab,
          questionId: currentQuestion?.id || null,
          entryLike: {
            answer: currentQuestion.answer,
            detail: currentQuestion.detail || null
          }
        });
      } else {
        setPendingReviewRemoval(null);
      }
      setDisabledMap((prev) => {
        const tabMap = { ...(prev[activeTab] || {}) };
        tabMap[idx] = { lockAll: true };
        return { ...prev, [activeTab]: tabMap };
      });
    } else {
      setPendingReviewRemoval(null);
      updateTabState(activeTab, {
        feedback: `Sai. Đáp án đúng: ${currentQuestion.answer}`,
        answered: currentTabState.answered + 1,
        lastResultCorrect: false
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
    const shouldRemoveWhenCorrectInReview = isPracticeTab && practiceSource === 'review';

    if (activeTab === 'translation') {
      const trimmed = String(input || '').trim();
      if (!trimmed) {
        updateTabState('translation', {
          checked: true,
          feedback: 'Hãy viết đoạn văn trước khi Confirm.',
          lastResultCorrect: false
        });
        return;
      }
      const words = translationWords.length ? translationWords : pickRandomVocabularyWords(translationWordCount);
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        words,
        content: trimmed
      };
      setWritingLogList((prev) => [entry, ...(Array.isArray(prev) ? prev : [])]);
      updateTabState('translation', {
        input: '',
        checked: true,
        feedback: 'Đã lưu vào Writing Log.',
        lastResultCorrect: true
      });
      refreshTranslationWords(translationWordCount);
      return;
    }
 
    // For write-word tab accept vocabulary OR any synonym token
    if (activeTab === 'write-word') {
      const acceptable = getAcceptableAnswers(currentQuestion); // normalized list
      const isCorrect = acceptable.includes(normalizedInput);
      const writeWordFeedback = buildWriteWordFeedback(currentQuestion);
      updateTabState(activeTab, {
        checked: true,
        feedback: isCorrect
          ? writeWordFeedback
          : writeWordFeedback,
        score: currentTabState.score + (isCorrect ? 1 : 0),
        answered: currentTabState.answered + 1,
        lastResultCorrect: isCorrect
      });
      if (isCorrect && shouldRemoveWhenCorrectInReview) {
        setPendingReviewRemoval({
          tabId: activeTab,
          questionId: currentQuestion?.id || null,
          entryLike: {
            answer: currentQuestion.answer,
            detail: currentQuestion.detail || null
          }
        });
      } else {
        setPendingReviewRemoval(null);
      }
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
      answered: currentTabState.answered + 1,
      lastResultCorrect: isCorrect
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

  const clearDisabledForTab = (tabId) => {
    setDisabledMap((prev) => ({ ...(prev || {}), [tabId]: {} }));
  };

  const handleNext = () => {
    if (
      pendingReviewRemoval
      && pendingReviewRemoval.tabId === activeTab
      && pendingReviewRemoval.questionId
      && pendingReviewRemoval.questionId === currentQuestion?.id
    ) {
      removeReviewEntry(pendingReviewRemoval.entryLike || {});
      setPendingReviewRemoval(null);
    }
    setHoveredOption(null);
    shouldAutoSpeakNextRef.current = !!voiceEnabled;
    if (isPracticeTab && practiceSource === 'review') {
      clearDisabledForTab(activeTab);
    }
    // wrap / recycle when reaching list length
    if (activeTab === 'translation') {
      refreshTranslationWords(translationWordCount);
      updateTabState(activeTab, { input: '', checked: false, feedback: '' });
      return;
    }
    if (activeTab === 'write-word') {
      const len = (practiceDataList && practiceDataList.length) || 1;
      const newIndex = (quizState[activeTab].index + 1) % len;
      shouldRefocusWriteWordRef.current = true;
    updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '', lastResultCorrect: null });
      clearDisabledForIndex(activeTab, newIndex);
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (practiceDataList && practiceDataList.length) || 0;
    const newIndex = mcqPracticeTabs.includes(activeTab)
      ? Math.min(currentTabState.index + 1, len)
      : ((currentTabState.index + 1) % (len || 1));
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '', lastResultCorrect: null });
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
        if (activeTab === 'translation' || activeTab === 'write-word' || activeTab === 'review' || activeTab === 'writing-log') return;
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
        const selectedText = getSelectedTextFromTarget(tgt);
        if (selectedText) {
          e.preventDefault();
          try { speak(selectedText, detectSpeechLang(selectedText)); } catch (err) { /* ignore */ }
          return;
        }
        if (isEditable) return; // avoid speaking while typing unless text is selected
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
    setPendingReviewRemoval(null);
    setHoveredOption(null);
    if (isPracticeTab && practiceSource === 'review') {
      clearDisabledForTab(activeTab);
    }
    // wrap backwards
    if (activeTab === 'translation') {
      refreshTranslationWords(translationWordCount);
      updateTabState(activeTab, { input: '', checked: false, feedback: '', lastResultCorrect: null });
      return;
    }
    if (activeTab === 'write-word') {
      const len = (practiceDataList && practiceDataList.length) || 1;
      const newIndex = (quizState[activeTab].index - 1 + len) % len;
      shouldRefocusWriteWordRef.current = true;
      updateTabState(activeTab, { index: newIndex, input: '', checked: false, feedback: '', lastResultCorrect: null });
      return;
    }
    const len = (orders[activeTab] && orders[activeTab].length) || (practiceDataList && practiceDataList.length) || 0;
    const newIndex = mcqPracticeTabs.includes(activeTab)
      ? Math.max(currentTabState.index - 1, 0)
      : ((currentTabState.index - 1 + (len || 1)) % (len || 1));
    updateTabState(activeTab, { index: newIndex, selected: '', checked: false, feedback: '', lastResultCorrect: null });
  };

  const handleResetLibrary = () => {
    const n = (practiceDataList && practiceDataList.length) || 0;
    setOrders((prev) => ({
      ...(prev || {}),
      'en-to-vi': buildRandomOrderIndexes(n),
      'vi-to-en': buildRandomOrderIndexes(n),
      mixed: buildRandomOrderIndexes(n)
    }));
    setPendingReviewRemoval(null);
    setHoveredOption(null);
    setDisabledMap((prev) => ({
      ...(prev || {}),
      'en-to-vi': {},
      'vi-to-en': {},
      mixed: {}
    }));
    setQuizState((prev) => ({
      ...prev,
      'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
      'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
      mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 }
    }));
  };

  const handleReset = () => {
    setPendingReviewRemoval(null);
    if (activeTab === 'translation') {
      refreshTranslationWords(translationWordCount);
      updateTabState(activeTab, { input: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null });
      setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
      return;
    }
    if (activeTab === 'write-word') {
      shouldRefocusWriteWordRef.current = true;
      updateTabState(activeTab, { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null });
      setDisabledMap((prev) => ({ ...(prev || {}), [activeTab]: {} }));
      return;
    }
    updateTabState(activeTab, { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0, lastResultCorrect: null });
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

  const handleClearWritingLog = () => {
    setWritingLogList([]);
  };

  const handleSwitchPracticeSource = (nextSource) => {
    if (nextSource === practiceSource) return;
    setPendingReviewRemoval(null);
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

    if (activeTab === 'translation') {
      setTranslationWords([]);
      updateTabState(activeTab, { input: '', checked: false, feedback: '', lastResultCorrect: null });
      return;
    }

    if (activeTab === 'write-word') {
      updateTabState(activeTab, { index: 0, input: '', checked: false, feedback: '', lastResultCorrect: null });
      return;
    }
    updateTabState(activeTab, { index: 0, selected: '', checked: false, feedback: '', lastResultCorrect: null });
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
      setMapping((m) => {
        const next = resolveMappingForHeaders(headers, m);
        mappingRef.current = next;
        return next;
      });
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
      const latestMapping = mappingRef.current || mapping;
      const mapped = mapSheetRowsToData(rows, latestMapping);
      const hasText = (value) => !!String(value || '').trim();
      const diagnostics = {
        totalMappedRows: mapped.length,
        withCat: mapped.filter((item) => hasText(item?.cat)).length,
        withVocabulary: mapped.filter((item) => hasText(item?.vocabulary)).length,
        withMeaning: mapped.filter((item) => hasText(item?.vietnamMeaning)).length,
        withSentenceEn: mapped.filter((item) => hasText(item?.sentences?.en)).length,
        withSentenceVi: mapped.filter((item) => hasText(item?.sentences?.vi)).length,
        withLearn: mapped.filter((item) => hasText(item?.learn)).length,
        validEnToVi: mapped.filter((item) => hasText(item?.vocabulary) && hasText(item?.vietnamMeaning)).length,
        validMixed: mapped.filter((item) => hasText(item?.vocabulary) && hasText(item?.sentences?.en)).length
      };
      console.table(diagnostics);
      if (mapped.length) {
        setDataList(mapped);
        setQuizState({
          'en-to-vi': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          'vi-to-en': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          mixed: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          'write-word': { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
          translation: { index: 0, input: '', checked: false, feedback: '', score: 0, answered: 0 },
          review: { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 },
          'writing-log': { index: 0, selected: '', checked: false, feedback: '', score: 0, answered: 0 }
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
  const formatWordWithType = (word, detail) => {
    const displayWord = String(word || detail?.vocabulary || '').trim();
    const rawType = String(detail?.type || '').trim();
    const displayType = rawType.replace(/^\((.*)\)$/, '$1').trim();
    if (!displayWord || !displayType) return displayWord;
    return (
      <span className="word-with-type">
        <span>{displayWord}</span>
        <span className="word-type">({displayType})</span>
      </span>
    );
  };
  const findDetailByVocabulary = (word) => {
    const target = normalizeText(word);
    if (!target) return null;
    return (practiceDataList || []).find((item) => normalizeText(item?.vocabulary || '') === target)
      || normalizedDataList.find((item) => normalizeText(item?.vocabulary || '') === target)
      || null;
  };
  const mobilePromptContent = useMemo(() => {
    if (!currentQuestion) return { primary: '', secondary: '' };

    if (activeTab === 'en-to-vi') {
      return {
        primary: formatWordWithType(currentQuestion?.detail?.vocabulary || currentQuestion?.prompt || '', currentQuestion?.detail),
        secondary: String(currentQuestion?.detail?.sentences?.en || '').trim()
      };
    }

    if (activeTab === 'vi-to-en') {
      return {
        primary: String(currentQuestion?.prompt || currentQuestion?.detail?.vietnamMeaning || '').trim(),
        secondary: String(currentQuestion?.detail?.sentences?.en || '').trim()
      };
    }

    if (activeTab === 'mixed') {
      return {
        primary: renderPromptText(),
        secondary: String(currentQuestion?.detail?.sentences?.vi || '').trim()
      };
    }

    if (activeTab === 'write-word') {
      return {
        primary: String(currentQuestion?.prompt || currentQuestion?.detail?.vietnamMeaning || '').trim(),
        secondary: String(currentQuestion?.detail?.sentences?.vi || '').trim()
      };
    }

    return {
      primary: String(currentQuestion?.prompt || '').trim(),
      secondary: ''
    };
  }, [activeTab, currentQuestion, renderPromptText, practiceDataList, normalizedDataList]);
  const currentPromptWord = mobilePromptContent.primary;
  const currentPromptExample = mobilePromptContent.secondary;
  const currentPromptSynonym = String(currentQuestion?.detail?.synonym || '').trim();
  const currentVoiceText = String(
    currentQuestion?.detail?.vocabulary
    || currentQuestion?.answer
    || ''
  ).trim();
  
  useEffect(() => {
    if (!shouldAutoSpeakNextRef.current) return;
    shouldAutoSpeakNextRef.current = false;
    if (!currentVoiceText) return;

    const timer = window.setTimeout(() => {
      speak(currentVoiceText, 'en-US');
    }, 30);

    return () => window.clearTimeout(timer);
  }, [currentQuestion?.id, currentVoiceText]);

  const reviewItems = [...(Array.isArray(reviewList) ? reviewList : [])].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
  const writingLogItems = [...(writingLogList || [])].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
  const activeGroupLabel = groupedTabs.find((t) => t.id === activeGroup)?.label || '';
  const activeModeLabel = activeGroup === 'mcq'
    ? (mcqModes.find((m) => m.id === mcqMode)?.label || '')
    : activeGroup === 'writing'
      ? (writingModes.find((m) => m.id === writingMode)?.label || '')
      : (libraryModes.find((m) => m.id === libraryMode)?.label || '');
  const sampleRow = sheetPreviewRows && sheetPreviewRows.length ? sheetPreviewRows[0] : null;
  const totalWordCount = normalizedDataList.length;
  const visibleWordCount = filteredVocabularyData.length;
  const resolveHeaderKey = (target) => {
    if (!target || !sheetHeaders || !sheetHeaders.length) return null;
    const t = String(target).trim().toLowerCase();
    let k = sheetHeaders.find((hh) => String(hh).trim().toLowerCase() === t);
    if (k) return k;
    k = sheetHeaders.find((hh) => {
      const hnorm = String(hh).trim().toLowerCase();
      return hnorm.includes(t) || t.includes(hnorm);
    });
    return k || null;
  };

  return (
    <div className="app-shell">
      <div className="background-blur blur-one" />
      <div className="background-blur blur-two" />
      <main className="container">
        <section className="hero-card">
          <div>
            <span className="eyebrow">Super Memo</span>
            <h1>Super Memo</h1>
            <p>Luyện từ vựng gọn gàng trên điện thoại với bộ dữ liệu của riêng bạn.</p>
          </div>
          <div className="score-board">
            <div className="top-tools-row">
              <button className="ghost-button settings-top-button" onClick={() => setSettingsOpen((s) => !s)}>Settings</button>
            </div>
            <div className="focus-range-bar hero-focus-range-bar">
              <div className="focus-range-controls">
                <label className="focus-range-field">
                  <span>Start</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="1"
                    value={wordRange?.start || ''}
                    onChange={(e) => updateWordRangeField('start', e.target.value)}
                  />
                </label>
                <label className="focus-range-field">
                  <span>End</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={totalWordCount ? String(totalWordCount) : '...'}
                    value={wordRange?.end || ''}
                    onChange={(e) => updateWordRangeField('end', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="ghost-button focus-range-reset"
                  onClick={clearWordRange}
                  disabled={!hasWordRange}
                >
                  All
                </button>
              </div>
            </div>
            <div className="category-filter-bar">
              <div className="category-filter-copy">
                <span className="category-filter-label">CAT Filter</span>
                <strong>{visibleWordCount}/{totalWordCount} vocab</strong>
                <span className="category-filter-summary">
                  {isAllCategoriesSelected ? 'All categories' : normalizedSelectedCategories.join(', ')}
                </span>
              </div>
              <div className="category-filter-chips" role="group" aria-label="Vocabulary CAT filter">
                {categoryOptions.map((category) => {
                  const isActive = category === CATEGORY_ALL
                    ? isAllCategoriesSelected
                    : normalizedSelectedCategories.includes(category);

                  return (
                    <button
                      key={category}
                      type="button"
                      className={`category-chip ${isActive ? 'active' : ''}`}
                      onClick={() => toggleCategory(category)}
                      aria-pressed={isActive}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {settingsOpen && (
          <section className="settings-panel" style={{ marginBottom: 18 }}>
            <h3>Data Source / Google Sheets</h3>
            <div className="settings-voice-row">
              <div>
                <h4>Auto Voice</h4>
                <p className="settings-voice-copy">Bật để mỗi lần bấm Next app tự đọc vocabulary. Tắt thì dùng nút loa hoặc phím v.</p>
              </div>
              <button
                type="button"
                className={`voice-toggle ${voiceEnabled ? 'is-on' : 'is-off'}`}
                onClick={toggleVoiceEnabled}
                role="switch"
                aria-checked={voiceEnabled}
                aria-label={`Voice auto next ${voiceEnabled ? 'on' : 'off'}`}
                title={voiceEnabled ? 'Auto đọc từ khi bấm Next đang bật' : 'Auto đọc từ khi bấm Next đang tắt'}
              >
                <span className="voice-toggle-track">
                  <span className="voice-toggle-thumb" />
                </span>
                <span className="voice-toggle-text">{voiceEnabled ? 'On' : 'Off'}</span>
              </button>
            </div>
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
                <div className="mapping-header-row">
                  <div>
                    <h4>Map headers to schema</h4>
                    <p className="mapping-helper-text">Keo header vao tung o. Moi field se hien header dang map va sample preview.</p>
                  </div>
                </div>
                <div className="mapping-grid">
                  {SCHEMA_FIELDS.map((field) => {
                    const mappedHeader = mapping[field.key] || '';
                    const resolvedKey = mappedHeader ? resolveHeaderKey(mappedHeader) : null;
                    const sample = sampleRow && resolvedKey ? (sampleRow[resolvedKey] ?? '—') : '—';
                    return (
                      <div
                        key={field.key}
                        onDragOver={(e) => handleDragOverSlot(e, field.key)}
                        onDragLeave={handleDragLeaveSlot}
                        onDrop={(e) => handleDropToField(e, field.key)}
                        className={`mapping-slot mapping-card ${dropHover === field.key ? 'hover' : ''} ${mappedHeader ? 'mapped' : ''}`}
                      >
                        <div className="mapping-card-top">
                          <div>
                            <label>{field.label}</label>
                            <div className="mapping-field-hint">{field.hint}</div>
                          </div>
                          {mappedHeader ? <span className="connected-badge" title="Mapped">✓</span> : null}
                        </div>

                        <div className="mapping-value">
                          {mappedHeader ? (
                            <>
                              <span className="mapped-name">{resolvedKey || mappedHeader}</span>
                              <button type="button" className="clear-mapping" onClick={() => clearMappingField(field.key)} title="Clear mapping">✕</button>
                            </>
                          ) : (
                            <em>drop header here</em>
                          )}
                        </div>

                        <div className="mapping-sample">
                          <span>Sample</span>
                          <strong>{String(sample || '—')}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              {sheetHeaders && sheetHeaders.length ? (
                <table style={{ width: '100%', fontSize: 13, marginTop: 8 }}>
                  <thead>
                    <tr><th style={{ textAlign: 'left' }}>Field</th><th style={{ textAlign: 'left' }}>Mapped header</th><th style={{ textAlign: 'left' }}>Preview sample</th></tr>
                  </thead>
                  <tbody>
                    {SCHEMA_FIELDS.map((field) => {
                      const hdr = mapping[field.key] || '';
                      const resolvedKey = hdr ? resolveHeaderKey(hdr) : null;
                      const sample = sampleRow && resolvedKey ? (sampleRow[resolvedKey] ?? '—') : '—';
                      return (
                        <tr key={field.key}>
                          <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{field.label}</td>
                          <td style={{ padding: '6px 8px', verticalAlign: 'top', color: resolvedKey ? '#000' : '#b00' }}>{resolvedKey || hdr || <em>none</em>}</td>
                          <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{String(sample)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <em>No headers to test</em>}
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
            {groupedTabs.map((tab) => (
              <button key={tab.id} className={`tab-button ${activeGroup === tab.id ? 'active' : ''}`} onClick={() => setActiveGroup(tab.id)}>{tab.label}</button>
            ))}
          </div>
        </section>

        <section className="practice-grid">
          <article className={`question-card ${activeTab === 'write-word' ? 'write-word-card' : ''}`}>
            <div className="card-header">
              <div>
                <span className="chip">
                  {activeGroupLabel}
                </span>
                <h2>
                  {activeTab === 'review' ? `Review (${reviewItems.length})`
                    : activeTab === 'writing-log' ? `Writing Log (${(writingLogItems || []).length})`
                    : activeModeLabel || currentQuestion?.title}
                </h2>
              </div>
              <div className="mode-switch">
                {(activeGroup === 'mcq' ? mcqModes : activeGroup === 'writing' ? writingModes : libraryModes).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mode-pill ${activeTab === mode.id ? 'active' : ''}`}
                    onClick={() => {
                      if (activeGroup === 'mcq') setMcqMode(mode.id);
                      else if (activeGroup === 'writing') setWritingMode(mode.id);
                      else setLibraryMode(mode.id);
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {isPracticeTab && activeGroup !== 'writing' && (
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
              {isPracticeTab && activeGroup === 'writing' && (
                <div className={`writing-source-stack ${activeTab === 'translation' ? 'has-random-zone' : ''}`}>
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
                  {activeTab === 'translation' && (
                    <div className="translation-header-controls">
                      <input
                        id="translation-word-count"
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        value={translationWordCount}
                        aria-label="Number of random words"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') return;
                          const parsed = Number.parseInt(raw, 10);
                          if (Number.isNaN(parsed)) return;
                          setTranslationWordCount(Math.max(1, Math.min(50, parsed)));
                        }}
                        onBlur={(e) => {
                          const parsed = Number.parseInt(e.target.value, 10);
                          const safe = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(50, parsed));
                          setTranslationWordCount(safe);
                        }}
                      />
                      <button type="button" className="ghost-button" onClick={() => refreshTranslationWords(translationWordCount)}>Random</button>
                    </div>
                  )}
                </div>
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
            ) : activeTab === 'writing-log' ? (
              <div className="review-panel">
                <div className="actions" style={{ marginBottom: 12 }}>
                  <button className="ghost-button" onClick={handleClearWritingLog} disabled={!writingLogItems.length}>Reset</button>
                </div>
                {writingLogItems.length ? (
                  <div className="review-list">
                    {writingLogItems.map((item) => (
                      <div key={item.id || `${item.ts}`} className="review-item">
                        <p><strong>Words:</strong> {(item.words || []).join(' | ') || '—'}</p>
                        <p className="review-meta" style={{ whiteSpace: 'pre-wrap' }}><strong>Your Writing:</strong> {item.content || '—'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="data-structure">
                    <p style={{ margin: 0 }}>Writing log is empty.</p>
                    <p style={{ marginTop: 6, fontSize: 13, color: '#666' }}>
                      Ở tab Viết lại câu, chọn số lượng từ rồi bấm Confirm để lưu bài viết vào đây.
                    </p>
                  </div>
                )}
              </div>
            ) : isMcqLibraryComplete ? (
              <div className="library-complete-box">
                <span className="prompt-label">Library complete</span>
                <h3>Bạn đã học hết toàn bộ từ trong bộ hiện tại.</h3>
                <p>
                  Bấm <strong>Reset Library</strong> để xáo trộn và hiển thị lại toàn bộ từ vựng.
                </p>
                <div className="actions">
                  <button className="primary-button" onClick={handleResetLibrary}>Reset Library</button>
                </div>
              </div>
            ) : !currentQuestion ? (
              <div className="data-structure">
                <p style={{ margin: 0 }}><strong>No question available for this mode.</strong></p>
                <p style={{ marginTop: 8 }}>
                  Data source: <strong>{isPracticeTab ? (practiceSource === 'review' ? 'Review Data' : 'Original Data') : 'Default'}</strong>.
                  {' '}Available words: {isPracticeTab ? (practiceDataList?.length || 0) : (filteredVocabularyData?.length || 0)}.
                </p>
                <p style={{ marginTop: 8, fontSize: 14, color: '#557261' }}>
                  Valid rows:
                  {' '}EN → VN <strong>{modeAvailability.enToVi}</strong>,
                  {' '}VN → EN <strong>{modeAvailability.viToEn}</strong>,
                  {' '}Cloze <strong>{modeAvailability.mixed}</strong>,
                  {' '}Viết lại từ <strong>{modeAvailability.writeWord}</strong>.
                </p>
                {isPracticeTab && practiceSource === 'review' ? (
                  <p style={{ marginTop: 8 }}>
                    Hãy lưu từ sai hoặc bấm Save để thêm từ vào Review, hoặc chuyển lại nguồn `Org`.
                  </p>
                ) : (
                  <p style={{ marginTop: 8 }}>
                    Mode hiện tại chưa có đủ dữ liệu để tạo câu hỏi. Bạn vẫn có thể chuyển sang mode khác như `EN → VN`, `VN → EN`, `Cloze`, hoặc `Viết lại từ`.
                  </p>
                )}
              </div>
            ) : (
              <>
                {(isMcqTab || activeTab === 'write-word') && (
                  <div className="mobile-practice-top">
                    {isMcqTab ? (
                      <div className="library-progress mobile-library-progress">
                        <div className="library-progress-item">
                          <span>Learned</span>
                          <strong>{learnedCount}</strong>
                        </div>
                        <div className="library-progress-item">
                          <span>Remain</span>
                          <strong>{remainCount}</strong>
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="mobile-voice-button"
                      onClick={() => speak(currentVoiceText, 'en-US')}
                      disabled={!currentVoiceText}
                      aria-label="Speak current word"
                      title="Speak current word"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 9v6h4l5 4V5L9 9H5z" />
                        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
                        <path d="M19 6a8.5 8.5 0 0 1 0 12" />
                      </svg>
                    </button>
                  </div>
                )}

                <div
                  className={`prompt-box ${activeTab === 'write-word' ? 'write-word-prompt-box' : ''}`}
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
                  <div className="desktop-prompt-text">
                    <p className="desktop-prompt-word">{currentPromptWord || renderPromptText()}</p>
                    {(currentPromptSynonym || currentPromptExample) ? (
                      <div className="prompt-support-lines">
                        {currentPromptSynonym ? (
                          <p className="prompt-support-line prompt-support-synonym">{currentPromptSynonym}</p>
                        ) : null}
                        {currentPromptExample ? (
                          <p className="prompt-support-line prompt-support-example">{currentPromptExample}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {isMcqTab || activeTab === 'write-word' ? (
                    <div className="mobile-prompt-body">
                      <p className="mobile-prompt-word">{currentPromptWord || renderPromptText()}</p>
                      {(currentPromptSynonym || currentPromptExample) ? (
                        <div className="prompt-support-lines mobile-prompt-support-lines">
                          {currentPromptSynonym ? (
                            <p className="prompt-support-line prompt-support-synonym">{currentPromptSynonym}</p>
                          ) : null}
                          {currentPromptExample ? (
                            <p className="prompt-support-line prompt-support-example mobile-prompt-example">{currentPromptExample}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {activeTab === 'translation' ? (
                  <div className="translation-area">
                    <div className="data-structure translation-words-box" style={{ marginBottom: 10 }}>
                      <span className="info-label">Từ gợi ý</span>
                      {(translationWords || []).length ? (
                        <div className="translation-words-list">
                          {translationWords.map((word) => (
                            <button
                              key={word}
                              type="button"
                              className="translation-word-chip"
                              onMouseEnter={() => setHoveredOption(word)}
                              onFocus={() => setHoveredOption(word)}
                              onTouchStart={() => setHoveredOption(word)}
                              title="Hover để xem side card"
                            >
                              {formatWordWithType(word, findDetailByVocabulary(word))}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>—</p>
                      )}
                    </div>
                    <textarea
                      value={currentTabState.input}
                      onChange={(e) => updateTabState('translation', { input: e.target.value, checked: false, feedback: '' })}
                      onKeyDown={(e) => {
                        // Enter = submit (confirm) when non-empty
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if ((currentTabState.input || '').trim()) handleCheck();
                        }
                        // Tab = random next set
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          handleNext();
                        }
                      }}
                      placeholder="Dùng các từ gợi ý ở trên để viết câu/đoạn văn..."
                    />
                  </div>
                ) : activeTab === 'write-word' ? (
                  <div className="translation-area write-word-area">
                    <textarea
                      ref={writeWordInputRef}
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
	                <div
                    className={`feedback-box ${currentTabState.feedback ? 'show' : ''} ${activeTab === 'write-word'
                      ? `write-word-feedback ${currentTabState.feedback ? (currentTabState.lastResultCorrect ? 'success' : 'error') : ''}`
                      : currentTabState.feedback
                        ? (/^chính xác/i.test(currentTabState.feedback) ? 'success' : 'error')
                        : ''} ${isMcqTab ? 'mcq-feedback' : ''}`}
                    aria-live="polite"
                  >
                    <span className="feedback-content">
	                      {currentTabState.feedback || '\u00A0'}
                    </span>
	                  </div>

	                <div className={`actions ${activeTab === 'write-word' ? 'write-word-actions' : ''}`}>
                  <button
                    className="secondary-button"
                    onPointerDown={activeTab === 'write-word' ? (e) => e.preventDefault() : undefined}
                    onClick={handleNext}
                  >
                    Next →
                  </button>
                  {isMcqTab && (
                    <div className="library-progress desktop-library-progress">
                      <div className="library-progress-item">
                        <span>Learned</span>
                        <strong>{learnedCount}</strong>
                      </div>
                      <div className="library-progress-item">
                        <span>Remain</span>
                        <strong>{remainCount}</strong>
                      </div>
                    </div>
                  )}
                  {activeTab === 'translation' ? (
                    <button className="primary-button" onClick={handleCheck}>Confirm</button>
                  ) : activeTab === 'write-word' ? (
                    <button
                      className="ghost-button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={handleReset}
                    >
                      Reset
                    </button>
                  ) : null}
                </div>

	                <div className={`data-structure learn-panel ${activeTab === 'write-word' ? 'write-word-learn-panel' : ''}`}>
                  <span className="info-label">Learn column (for current word)</span>
                  <div className="learn-panel-content">
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
              <p className="translate-result">{translatePopover.translatedText || 'Khong co ket qua.'}</p>
            )}
          </div>
        </div>
      )}
      <div className={`saved-toast ${showSavedToast ? 'show' : ''}`}>Saved</div>
    </div>
  );
}
