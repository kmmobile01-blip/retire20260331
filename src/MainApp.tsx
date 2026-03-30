import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { 
    Calculator, Settings, Download, Upload, Search, 
    FileSpreadsheet, Loader2, AlertCircle, CheckCircle2, Sliders,
    FileDown, Database, Trash2, ShieldCheck, RotateCcw, Copy, FileText,
    PieChart, Users, Medal, ChevronDown, ChevronUp, UserPlus, Calendar, ArrowRightCircle, HelpCircle,
    Play, Lock, RefreshCw, Key, Save
} from 'lucide-react';
import { 
    EmployeeInputRow, TableRowT1, TableRowT2, CoefSettings, 
    CalculationResult, SimulationConfig, FractionConfig, AggregatedYearlyData, YearlyDetail, CoefRow
} from './types';
import { 
    SAMPLE_EMPLOYEE_DATA, DEFAULT_TABLE_1_1, DEFAULT_TABLE_1_2, DEFAULT_TABLE_1_3, DEFAULT_TABLE_2, 
    DEFAULT_COEF_SETTINGS, T1_CSV_HEADERS, T2_CSV_HEADERS, 
    COEF_CSV_HEADERS, COL_ALIASES, EMPLOYEE_CSV_HEADERS
} from './constants';
import { processRow, roundTo2, formatDateWithWareki, parseDate, calculatePeriodYears, deepClone, logError } from './utils';
import { ChatConsultant } from './components/ChatConsultant';
import { ResultCard } from './components/ResultCard';
import { AIAnalysisReport } from './components/AIAnalysisReport';
import { MasterEditorModal } from './components/MasterEditorModal';
import { HelpModal } from './components/HelpModal';
import { AnnualCostChart } from './components/AnnualCostChart';
import { ApiSettingsModal } from './components/ApiSettingsModal';

// 旧制度マスタ(T1形式)を新制度マスタ(T2形式)の構造に変換するヘルパー
const convertT1toT2 = (t1: TableRowT1[]): TableRowT2[] => {
    return t1.map(row => ({
        y: row.y,
        los: row.los1, // 旧勤続 -> 新勤続
        r1: row.r1_1,  // 旧係員 -> 新係員
        r2: row.r2,
        r3: row.r3,
        r4: row.r4,
        r5: row.r5,
        r6: row.r6
    }));
};

// デフォルト設定
const DEFAULT_CONFIG: Omit<SimulationConfig, 'label'> = {
    unitPrice: 10000,
    masterDataSource: 'default',
    // 現行
    defaultYearlyEval: 0,
    retirementAges: { type1: 60, type2: 60, type3: 60, type4: 60 },
    cutoffYears: { type1: 35, type2: 36, type3: 37 },
    // 将来
    defaultYearlyEvalFuture: 0,
    retirementAgesFuture: { type1: 60, type2: 60, type3: 60, type4: 60 },
    cutoffYearsFuture: { type1: 35, type2: 36, type3: 37 },

    transitionConfig: { enabled: false, date: new Date(2027, 2, 31) }, // 2027/03/31
    adjustmentConfig: { 
        enabled: false,
        retirementAges: { type1: 65, type2: 65, type3: 65, type4: 65 } 
    }, 
    unifyNewSystemConfig: {
        enabled: false,
        retirementAges: { type1: 60, type2: 60, type3: 65, type4: 65 },
        targetTypes: { type1: false, type2: false, type3: true, type4: true }
    },
    masterData1_1: DEFAULT_TABLE_1_1,
    masterData1_2: DEFAULT_TABLE_1_2,
    masterData1_3: DEFAULT_TABLE_1_3,
    masterData2: DEFAULT_TABLE_2,
    masterDataFuture: {
        type1: convertT1toT2(DEFAULT_TABLE_1_1), // 旧制度1の現行値をデフォルトに
        type2: convertT1toT2(DEFAULT_TABLE_1_2), // 旧制度2の現行値をデフォルトに
        type3: convertT1toT2(DEFAULT_TABLE_1_3), // 旧制度3の現行値をデフォルトに
        type4: DEFAULT_TABLE_2,                  // 新制度の現行値をデフォルトに
    },
    coefSettings: DEFAULT_COEF_SETTINGS,
    coefSettingsFuture: DEFAULT_COEF_SETTINGS,
};

export default function MainApp() {
    // --- State ---
    const [data, setData] = useState<EmployeeInputRow[]>([]); 
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [showApiSettings, setShowApiSettings] = useState<boolean>(false);
    const [customApiKey, setCustomApiKey] = useState<string>(localStorage.getItem('custom_gemini_api_key') || '');
    
    // Deep Clone for independence
    const [configA, setConfigA] = useState<SimulationConfig>({ 
        ...deepClone(DEFAULT_CONFIG), 
        label: 'パターンA (変更案)',
        transitionConfig: { enabled: false, date: new Date(2027, 2, 31) }
    });
    const [configB, setConfigB] = useState<SimulationConfig>({ ...deepClone(DEFAULT_CONFIG), label: 'パターンB (現行制度)' });

    const [status, setStatus] = useState<string>('待機中');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<number>(0);
    const [isCalculating, setIsCalculating] = useState<boolean>(false);
    const [includeDetailedCsv, setIncludeDetailedCsv] = useState<boolean>(false);
    
    // Manual Trigger
    const [calcTrigger, setCalcTrigger] = useState<number>(0);
    
    // Master Editor State
    const [editingPattern, setEditingPattern] = useState<'A' | 'B' | null>(null);

    // Aggregated Data for Chart
    const [aggregatedData, setAggregatedData] = useState<AggregatedYearlyData[]>([]);

    // Settings (Hidden/Fixed)
    const [fractionConfig] = useState<FractionConfig>({ 
        los: 'ceil', rank: 'ceil', eval: 'ceil', 
        losDateMode: 'end_of_month', rankDateMode: 'end_of_month', evalDateMode: 'end_of_month' 
    });
    const [includeCurrentFiscalYear] = useState<boolean>(false);

    // Search State
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Analysis View State
    const [showAnalysis, setShowAnalysis] = useState<boolean>(false);

    // Helper to run calculation
    const runCalculation = useCallback((
        row: EmployeeInputRow, 
        config: SimulationConfig, 
        targetB: number | undefined = undefined,
        targetReserve2026: number | undefined = undefined
    ) => {
        const useDefault = config.masterDataSource === 'default';
        return processRow(
            row, 
            useDefault ? DEFAULT_TABLE_1_1 : config.masterData1_1, 
            useDefault ? DEFAULT_TABLE_1_2 : config.masterData1_2, 
            useDefault ? DEFAULT_TABLE_1_3 : config.masterData1_3, 
            useDefault ? DEFAULT_TABLE_2 : config.masterData2, 
            useDefault ? {
                type1: convertT1toT2(DEFAULT_TABLE_1_1),
                type2: convertT1toT2(DEFAULT_TABLE_1_2),
                type3: convertT1toT2(DEFAULT_TABLE_1_3),
                type4: DEFAULT_TABLE_2,
            } : config.masterDataFuture,
            config.retirementAges, 
            config.cutoffYears, 
            useDefault ? DEFAULT_COEF_SETTINGS : config.coefSettings, 
            useDefault ? DEFAULT_COEF_SETTINGS : config.coefSettingsFuture, 
            config.defaultYearlyEval, 
            fractionConfig, 
            includeCurrentFiscalYear, 
            config.unitPrice,
            config.transitionConfig, 
            config.retirementAgesFuture, 
            config.cutoffYearsFuture, 
            config.defaultYearlyEvalFuture, 
            config.adjustmentConfig, 
            config.unifyNewSystemConfig, 
            targetB, 
            targetReserve2026 
        );
    }, [fractionConfig, includeCurrentFiscalYear]);

    // --- Search Logic ---
    const executeSearch = useCallback(() => {
        setSelectedEmployeeId(null);
        setSearchError(null);
        const term = searchTerm.trim(); 
        if (!term) return;
        
        if (data.length === 0) { 
            setSearchError('データがありません。先に社員データをアップロードしてください。'); 
            return; 
        }

        const found = data.find((row: EmployeeInputRow) => {
            const idVal = COL_ALIASES.id.reduce((found: string | number | undefined, alias) => found || row[alias], undefined);
            if (String(idVal) === term) return true;
            const nameVal = COL_ALIASES.name.reduce((found: string | number | undefined, alias) => found || row[alias], undefined);
            if (nameVal && String(nameVal).includes(term)) return true;
            return false;
        });

        if (found) {
            // IDを取得してセット
            const id = String(COL_ALIASES.id.reduce((f: string | number | undefined, a) => f || found[a], undefined));
            setSelectedEmployeeId(id);
        } else { 
            setSearchError('該当する社員が見つかりませんでした。'); 
        }
    }, [data, searchTerm]);

    // Derived Result for Selected Employee
    const searchResult = useMemo(() => {
        if (!selectedEmployeeId || data.length === 0) return null;
        
        const found = data.find((row: EmployeeInputRow) => {
            const idVal = COL_ALIASES.id.reduce((f: string | number | undefined, a) => f || row[a], undefined);
            return String(idVal) === selectedEmployeeId;
        });

        if (!found) return null;

        // B Calculation (Standard)
        const resB = runCalculation(found, configB);
        // A Calculation (May depend on B)
        const targetAmount = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.retirementAllowance : undefined;
        // Pass B's 2026 reserve to ensure consistency in adjustment mode
        const targetReserve = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.reserve2026 : undefined;
        
        const resA = runCalculation(found, configA, targetAmount, targetReserve);

        if (resA && resB) {
            return { resA, resB };
        }
        return null;
    }, [selectedEmployeeId, data, configA, configB, runCalculation]);

    // Auto-search (Initial Load or when data changes but search term exists)
    useEffect(() => {
        if (data.length > 0 && !selectedEmployeeId && !searchTerm) {
            const sorted = [...data].sort((a, b) => {
                const idA = String(a['社員番号'] || a['employeeId'] || '999999');
                const idB = String(b['社員番号'] || b['employeeId'] || '999999');
                return idA.localeCompare(idB, undefined, {numeric: true});
            });
            if(sorted.length > 0) {
                const minId = String(sorted[0]['社員番号'] || sorted[0]['employeeId'] || '');
                setSearchTerm(minId);
            }
        }
    }, [data, selectedEmployeeId, searchTerm]);

    // --- Aggregation Logic (Manual Trigger + Config Change) ---
    useEffect(() => {
        let isCancelled = false;

        const calculateAggregatedCosts = async () => {
            if (!data || data.length === 0) {
                setAggregatedData([]);
                return;
            }
            setIsCalculating(true);
            setProgress(0);
            setStatus('集計準備中...');
            await new Promise(resolve => setTimeout(resolve, 10));
            if (isCancelled) return;

            const costsMap = new Map<number, {
                A: { t1: number, t2: number, t3: number, t4: number },
                B: { t1: number, t2: number, t3: number, t4: number },
                counts: { t1: number, t2: number, t3: number, t4: number }
            }>();

            // 2025年度から集計開始 (期間延長: 2080まで)
            for (let y = 2025; y <= 2080; y++) {
                costsMap.set(y, {
                    A: { t1: 0, t2: 0, t3: 0, t4: 0 },
                    B: { t1: 0, t2: 0, t3: 0, t4: 0 },
                    counts: { t1: 0, t2: 0, t3: 0, t4: 0 }
                });
            }

            const d1999 = new Date(1999, 2, 31);
            const d2000 = new Date(2000, 2, 31);
            const d2011 = new Date(2011, 8, 30);

            let index = 0;
            const BATCH_SIZE = 50;
            const startTime = Date.now();

            while (index < data.length) {
                if (isCancelled) return;
                let count = 0;
                while (index < data.length && count < BATCH_SIZE) {
                    const row = data[index];
                    // Must calculate B first to handle Adjustment Mode in A
                    const resB = runCalculation(row, configB);
                    const targetAmount = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.retirementAllowance : undefined;
                    const targetReserve = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.reserve2026 : undefined;
                    
                    const resA = runCalculation(row, configA, targetAmount, targetReserve);

                    if (resA && resB) {
                        // Determine System Type based on join date
                        const jd = resA.joinDate;
                        let typeKey: 't1' | 't2' | 't3' | 't4' = 't4';
                        if (jd <= d1999) typeKey = 't1';
                        else if (jd <= d2000) typeKey = 't2';
                        else if (jd <= d2011) typeKey = 't3';

                        // For counts: check if active at fiscal year end
                        // 2025年度から集計
                        for (let y = 2025; y <= 2080; y++) {
                            const fiscalYearEnd = new Date(y + 1, 2, 31);
                            if (resA.retirementDate >= fiscalYearEnd) {
                                if(costsMap.has(y)) costsMap.get(y)!.counts[typeKey] += 1;
                            }
                        }

                        // For costs
                        resA.yearlyDetails.forEach((d: YearlyDetail) => { if (costsMap.has(d.year)) costsMap.get(d.year)!.A[typeKey] += d.amountInc; });
                        resB.yearlyDetails.forEach((d: YearlyDetail) => { if (costsMap.has(d.year)) costsMap.get(d.year)!.B[typeKey] += d.amountInc; });
                    }
                    index++;
                    count++;
                }
                
                const currentProgress = Math.round((index / data.length) * 100);
                setProgress(currentProgress);
                
                const elapsedTime = Date.now() - startTime;
                const estimatedTotalTime = (elapsedTime / index) * data.length;
                const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
                
                setStatus(`集計中... ${currentProgress}% (残り約${remainingTime}秒)`);
                await new Promise(r => setTimeout(r, 0));
            }

            if (isCancelled) return;

            const sorted: AggregatedYearlyData[] = Array.from(costsMap.entries())
                .map(([year, val]) => {
                    const totalA = val.A.t1 + val.A.t2 + val.A.t3 + val.A.t4;
                    const totalB = val.B.t1 + val.B.t2 + val.B.t3 + val.B.t4;
                    const totalCount = val.counts.t1 + val.counts.t2 + val.counts.t3 + val.counts.t4;
                    return {
                        year,
                        A: { type1: val.A.t1, type2: val.A.t2, type3: val.A.t3, type4: val.A.t4, total: totalA },
                        B: { type1: val.B.t1, type2: val.B.t2, type3: val.B.t3, type4: val.B.t4, total: totalB },
                        counts: { type1: val.counts.t1, type2: val.counts.t2, type3: val.counts.t3, type4: val.counts.t4, total: totalCount }
                    };
                })
                .sort((a, b) => a.year - b.year);
            
            setAggregatedData(sorted);
            setIsCalculating(false);
            setStatus('再計算完了');
            setTimeout(() => { if (!isCancelled) setStatus('待機中'); }, 2000);
        };

        calculateAggregatedCosts();

        return () => {
            isCancelled = true;
        };
    }, [data, calcTrigger, configA, configB, runCalculation]);

    const handleRunSimulation = () => {
        setCalcTrigger((prev: number) => prev + 1);
    };

    // --- Data Analysis Logic ---
    const analysisResult = useMemo(() => {
        if (data.length === 0) return null;
        
        const d1999 = new Date(1999, 2, 31);
        const d2000 = new Date(2000, 2, 31);
        const d2011 = new Date(2011, 8, 30);
        
        // 基準日: デフォルトは現在。改定日設定があればそれを使用
        let refDate = new Date();
        refDate.setHours(0,0,0,0);
        let isTransitionDate = false;

        if (configA.transitionConfig.enabled && configA.transitionConfig.date) {
            refDate = new Date(configA.transitionConfig.date);
            isTransitionDate = true;
        } else if (configB.transitionConfig.enabled && configB.transitionConfig.date) {
            refDate = new Date(configB.transitionConfig.date);
            isTransitionDate = true;
        }

        const groups = {
            type1: [] as any[],
            type2: [] as any[],
            type3: [] as any[],
            type4: [] as any[]
        };

        data.forEach((row: EmployeeInputRow) => {
            const jd = parseDate(row['入社日'] || row['joinDate']);
            if (!jd) return;
            const bd = parseDate(row['生年月日'] || row['birthDate']);
            const item = { ...row, _joinDate: jd, _birthDate: bd };
            
            if (jd <= d1999) groups.type1.push(item);
            else if (jd <= d2000) groups.type2.push(item);
            else if (jd <= d2011) groups.type3.push(item);
            else groups.type4.push(item);
        });

        const getCoef = (d: Date, years: number) => {
            let table = [];
            if (d <= d1999) table = configB.coefSettings.type1;
            else if (d <= d2000) table = configB.coefSettings.type2;
            else if (d <= d2011) table = configB.coefSettings.type3;
            else table = configB.coefSettings.type4;
            
            if (!table || table.length === 0) return 1.0;
            const y = Math.max(1, Math.floor(years));
            const r = table.find((x: CoefRow) => x.years === y) || table[table.length - 1];
            return r ? r.coef : 1.0;
        };

        const processGroup = (list: any[]) => {
            if (list.length === 0) return null;
            list.sort((a, b) => a._joinDate.getTime() - b._joinDate.getTime());
            
            const oldest = list[0];
            const newest = list[list.length - 1]; 

            const calcYears = (d: Date) => calculatePeriodYears(d, refDate, 'floor');
            const calcAge = (birth: Date | null | undefined) => {
                if(!birth) return null;
                return Math.floor(calculatePeriodYears(birth, refDate, 'floor'));
            }
            
            const oldestYears = calcYears(oldest._joinDate);
            const newestYears = calcYears(newest._joinDate);

            return {
                count: list.length,
                oldest: {
                    name: oldest['氏名'] || oldest['name'] || '不明',
                    id: oldest['社員番号'] || oldest['employeeId'] || '不明',
                    date: oldest._joinDate,
                    years: oldestYears,
                    age: calcAge(oldest._birthDate),
                    coef: getCoef(oldest._joinDate, oldestYears)
                },
                newest: {
                    name: newest['氏名'] || newest['name'] || '不明',
                    id: newest['社員番号'] || newest['employeeId'] || '不明',
                    date: newest._joinDate,
                    years: newestYears,
                    age: calcAge(newest._birthDate),
                    coef: getCoef(newest._joinDate, newestYears)
                }
            };
        };

        return {
            type1: processGroup(groups.type1),
            type2: processGroup(groups.type2),
            type3: processGroup(groups.type3),
            type4: processGroup(groups.type4),
            total: data.length,
            refDateStr: formatDateWithWareki(refDate),
            isTransitionDate
        };
    }, [data, configB.coefSettings, configA.transitionConfig, configB.transitionConfig]); 


    const [isDragging, setIsDragging] = useState(false);

    // --- Handlers ---
    const processFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const buf = evt.target?.result;
                const wb = XLSX.read(buf, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as EmployeeInputRow[];
                if (json.length === 0) throw new Error("データなし");
                setData(json);
                setSelectedEmployeeId(null);
                alert(`社員データ ${json.length}件を読み込みました`);
                setCalcTrigger((prev: number) => prev + 1); // Trigger calc on load
            } catch (err: any) { 
                logError('Failed to process employee data file', err, { fileName: file.name, fileSize: file.size, fileType: file.type });
                alert('データ読込エラー: ' + err.message); 
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleDataFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; 
        if (!file) return;
        processFile(file);
        e.target.value = '';
    };

    const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    const handleDownloadTemplate = () => {
        const csv = Papa.unparse({ fields: EMPLOYEE_CSV_HEADERS, data: [] });
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "社員データ入力用テンプレート.csv";
        link.click();
    };

    const handleClearData = () => {
        if (window.confirm('データをクリアしますか？')) {
            setData([]); setAggregatedData([]); setSelectedEmployeeId(null); setSearchTerm(''); setStatus('待機中');
            setShowAnalysis(false);
        }
    };

    const handleLoadSampleData = () => {
        setData(SAMPLE_EMPLOYEE_DATA);
        setStatus('サンプルデータを読み込みました。再計算を実行してください。');
    };

    const handleCopyResults = () => {
        if (aggregatedData.length === 0) {
            setStatus('コピーする結果がありません');
            return;
        }
        const totalA = aggregatedData.reduce((sum, d) => sum + d.A.total, 0);
        const totalB = aggregatedData.reduce((sum, d) => sum + d.B.total, 0);
        const diff = totalA - totalB;
        const text = `【退職金シミュレーション結果】\nパターンA (変更案): ${Math.round(totalA).toLocaleString()}千円\nパターンB (現行制度): ${Math.round(totalB).toLocaleString()}千円\n差額: ${Math.round(diff).toLocaleString()}千円`;
        navigator.clipboard.writeText(text).then(() => {
            setStatus('結果をクリップボードにコピーしました');
        }).catch((err) => {
            logError('Failed to copy results to clipboard', err, { textLength: text.length });
            setStatus('クリップボードへのコピーに失敗しました');
        });
    };

    const handleSaveConfig = () => {
        const configData = {
            configA,
            configB
        };
        const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `simulation_config_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('設定を保存しました');
        setTimeout(() => setStatus('待機中'), 2000);
    };

    const handleLoadConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const parsed = JSON.parse(content);
                if (parsed.configA && parsed.configB) {
                    // Convert date strings back to Date objects if necessary
                    const restoreDates = (config: any) => {
                        if (config.transitionConfig?.date) {
                            config.transitionConfig.date = new Date(config.transitionConfig.date);
                        }
                        return config;
                    };
                    
                    setConfigA(restoreDates(parsed.configA));
                    setConfigB(restoreDates(parsed.configB));
                    setStatus('設定を読み込みました');
                    setTimeout(() => setStatus('待機中'), 2000);
                } else {
                    throw new Error('Invalid config format');
                }
            } catch (error) {
                logError('Failed to load config', error, { fileName: file.name, fileSize: file.size });
                alert('設定ファイルの読み込みに失敗しました。正しい形式のJSONファイルを選択してください。');
                setStatus('設定の読み込みに失敗しました');
            }
        };
        reader.readAsText(file);
        // Reset input so the same file can be loaded again if needed
        event.target.value = '';
    };

    const handleResetSettings = (target: 'A' | 'B') => {
        if (window.confirm(`${target === 'A' ? 'パターンA' : 'パターンB'}の設定を初期値に戻しますか？`)) {
            const def = { ...deepClone(DEFAULT_CONFIG), label: target === 'A' ? 'パターンA (変更案)' : 'パターンB (現行制度)' };
            if (target === 'A') setConfigA(def);
            else setConfigB(def);
        }
    };
    
    const handleMasterSave = (newConfig: SimulationConfig) => {
        if (editingPattern === 'A') {
            setConfigA(newConfig);
        } else {
            setConfigB(newConfig);
        }
    };

    const handleApplyAIProposal = (newConfig: SimulationConfig) => {
        setConfigA(newConfig);
        // Force calculation trigger slightly after state update
        setTimeout(() => setCalcTrigger(prev => prev + 1), 100);
    };

    const handleCalculateAndExport = async (format: 'xlsx' | 'csv') => {
        if (!data.length) return;
        setStatus('計算開始...'); setError(null); setProgress(0); setIsCalculating(true);
        
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const filename = `退職金シミュレーション比較_${timestamp}.${format}`;

        const processInTimeSlices = async () => {
            const results: { resA: CalculationResult, resB: CalculationResult }[] = [];
            let index = 0;
            const BATCH_SIZE = 50; 
            const startTime = Date.now();

            while (index < data.length) {
                let count = 0;
                while (index < data.length && count < BATCH_SIZE) {
                    const r = data[index];
                    const resB = runCalculation(r, configB);
                    const targetAmount = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.retirementAllowance : undefined;
                    const targetReserve = (configA.adjustmentConfig?.enabled || configA.unifyNewSystemConfig?.enabled) && resB ? resB.reserve2026 : undefined;
                    const resA = runCalculation(r, configA, targetAmount, targetReserve);
                    if(resA && resB) results.push({ resA, resB });
                    index++; count++;
                }
                const currentProgress = Math.round((index / data.length) * 100);
                setProgress(currentProgress);
                
                const elapsedTime = Date.now() - startTime;
                const estimatedTotalTime = (elapsedTime / index) * data.length;
                const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
                
                setStatus(`計算中... ${currentProgress}% (残り約${remainingTime}秒)`);
                await new Promise(r => setTimeout(r, 0));
            }
            return results;
        };

        try {
            await new Promise(r => setTimeout(r, 10)); 
            const results = await processInTimeSlices();
            if (results.length === 0) throw new Error("計算結果が0件でした。");

            // Build Headers
            const headers = [
                "社員番号","氏名","制度区分","入社日","生年月日",
                "【A】定年日", "【A】勤続年数", "【A】退職時総Pt", "【A】勤続Pt", "【A】職能Pt", "【A】考課Pt", "【A】調整Pt", "【A】退職金支給額", "【A】2026/3末引当残",
                "【B】定年日", "【B】勤続年数", "【B】退職時総Pt", "【B】勤続Pt", "【B】職能Pt", "【B】考課Pt", "【B】調整Pt", "【B】退職金支給額", "【B】2026/3末引当残",
                "支給額差分(A-B)", "引当残差分(A-B)"
            ];
            
            // Output columns up to 2080 to match calculation range
            for(let y=2025; y<=2080; y++) {
                headers.push(`${y}年度費用(A)`);
                headers.push(`${y}年度費用(差A-B)`);
            }

            const outData = [headers, ...results.map(({ resA, resB }) => {
                const row: any[] = [
                    resA.employeeId, resA.name, resA.typeName, formatDateWithWareki(resA.joinDate), formatDateWithWareki(resA.birthDate),
                    formatDateWithWareki(resA.retirementDate), resA.yearsOfService, resA.totalPointsAtRetirement, resA.totalLosPoints, resA.totalRankPoints, resA.totalEvalPoints, resA.totalAdjustmentPoints, resA.retirementAllowance, resA.reserve2026,
                    formatDateWithWareki(resB.retirementDate), resB.yearsOfService, resB.totalPointsAtRetirement, resB.totalLosPoints, resB.totalRankPoints, resB.totalEvalPoints, resB.totalAdjustmentPoints, resB.retirementAllowance, resB.reserve2026,
                    resA.retirementAllowance - resB.retirementAllowance, resA.reserve2026 - resB.reserve2026
                ];
                for(let y=2025; y<=2080; y++) { 
                    const dA = resA.yearlyDetails.find(d => d.year === y);
                    const dB = resB.yearlyDetails.find(d => d.year === y);
                    row.push(dA ? dA.amountInc : 0);
                    row.push((dA ? dA.amountInc : 0) - (dB ? dB.amountInc : 0));
                }
                return row;
            })];

            let detailedData: any[][] = [];
            if (includeDetailedCsv) {
                const detailedHeaders = [
                    "パターン", "社員番号", "氏名", "生年月日", "入社日", "退職金区分", "年度", "年齢", "勤続年数", "支給率",
                    "勤続ポイント増", "職能ポイント増", "考課ポイント増", "調整ポイント増", "単年度ポイント増加額",
                    "勤続ポイント累計", "職能ポイント累計", "考課ポイント累計", "調整ポイント累計", "累積ポイント合計",
                    "当年度費用(千円)"
                ];
                detailedData = [detailedHeaders];

                results.forEach(({ resA, resB }) => {
                    const years = new Set<number>();
                    resA.yearlyDetails.forEach(d => years.add(d.year));
                    resB.yearlyDetails.forEach(d => years.add(d.year));
                    const sortedYears = Array.from(years).sort((a, b) => a - b);

                    sortedYears.forEach(year => {
                        const dA = resA.yearlyDetails.find(d => d.year === year);
                        const dB = resB.yearlyDetails.find(d => d.year === year);
                        const yos = calculatePeriodYears(resA.joinDate, new Date(year, 3, 1));

                        if (dA) {
                            detailedData.push([
                                "A(変更案)", resA.employeeId, resA.name, formatDateWithWareki(resA.birthDate), formatDateWithWareki(resA.joinDate), resA.typeName, year, dA.age, yos, dA.coef,
                                dA.losPtInc, dA.rankPtInc, dA.evalPtInc, dA.adjustmentPtInc, dA.losPtInc + dA.rankPtInc + dA.evalPtInc + dA.adjustmentPtInc,
                                dA.accLosPt || 0, dA.accRankPt || 0, dA.accEvalPt || 0, dA.accAdjustmentPt || 0, dA.totalPt,
                                dA.amountInc
                            ]);
                        }
                        if (dB) {
                            detailedData.push([
                                "B(現行制度)", resB.employeeId, resB.name, formatDateWithWareki(resB.birthDate), formatDateWithWareki(resB.joinDate), resB.typeName, year, dB.age, yos, dB.coef,
                                dB.losPtInc, dB.rankPtInc, dB.evalPtInc, dB.adjustmentPtInc, dB.losPtInc + dB.rankPtInc + dB.evalPtInc + dB.adjustmentPtInc,
                                dB.accLosPt || 0, dB.accRankPt || 0, dB.accEvalPt || 0, dB.accAdjustmentPt || 0, dB.totalPt,
                                dB.amountInc
                            ]);
                        }
                    });
                });
            }

            if (format === 'csv') {
                if (includeDetailedCsv) {
                    const zip = new JSZip();
                    const encoder = new TextEncoder();
                    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
                    
                    const aggregatedCsv = Papa.unparse(outData);
                    const aggregatedBytes = encoder.encode(aggregatedCsv);
                    const aggregatedWithBom = new Uint8Array(bom.length + aggregatedBytes.length);
                    aggregatedWithBom.set(bom);
                    aggregatedWithBom.set(aggregatedBytes, bom.length);
                    zip.file(`比較結果_集計_${timestamp}.csv`, aggregatedWithBom);
                    
                    const detailedCsv = Papa.unparse(detailedData);
                    const detailedBytes = encoder.encode(detailedCsv);
                    const detailedWithBom = new Uint8Array(bom.length + detailedBytes.length);
                    detailedWithBom.set(bom);
                    detailedWithBom.set(detailedBytes, bom.length);
                    zip.file(`比較結果_個人別詳細_${timestamp}.csv`, detailedWithBom);
                    
                    const content = await zip.generateAsync({ type: 'blob' });
                    saveAs(content, `退職金シミュレーション_${timestamp}.zip`);
                } else {
                    const csv = Papa.unparse(outData);
                    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    link.click();
                }
            } else {
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(outData), "比較結果");
                if (includeDetailedCsv) {
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailedData), "個人別詳細");
                }
                XLSX.writeFile(wb, filename);
            }
            setStatus('完了'); setProgress(100);
        } catch (e: any) { 
            logError('Failed to calculate and export', e, { format, includeDetailedCsv, dataLength: data.length });
            setError(e.message); setStatus('エラー'); 
        } finally {
            setIsCalculating(false);
        }
    };

    // Helper for Settings Panel
    const renderSettingsPanel = (config: SimulationConfig, setConfig: React.Dispatch<React.SetStateAction<SimulationConfig>>, label: string) => {
        const pattern = label.includes('A') ? 'A' : 'B';
        return (
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-2">
                <div className="font-bold text-slate-700 flex items-center gap-2 text-lg">
                    <span className={`w-4 h-4 rounded-full ${label.includes('A') ? 'bg-indigo-600' : 'bg-emerald-500'}`}></span>
                    {config.label}
                </div>
                <button 
                    onClick={() => handleResetSettings(pattern as 'A'|'B')}
                    className="text-sm text-slate-400 hover:text-orange-600 flex items-center gap-1 font-bold"
                >
                    <RotateCcw className="w-4 h-4"/> 初期値
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ポイント単価 (円)</label>
                    <input type="number" value={config.unitPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({...config, unitPrice: Number(e.target.value)})} className="w-full p-2.5 border-slate-300 rounded text-base text-right" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">標準考課Pt (年)</label>
                    <input type="number" value={config.defaultYearlyEval} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({...config, defaultYearlyEval: Number(e.target.value)})} className="w-full p-2.5 border-slate-300 rounded text-base text-right" />
                </div>
            </div>

            {/* Transition Settings */}
            <div className={`p-4 rounded-lg border-2 transition-colors ${config.transitionConfig.enabled ? 'bg-indigo-50 border-indigo-500' : 'bg-slate-100 border-slate-200'}`}>
                <div className="flex items-center gap-3">
                    <input 
                        type="checkbox" 
                        id={`trans-${pattern}`}
                        checked={config.transitionConfig.enabled}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, transitionConfig: { ...config.transitionConfig, enabled: e.target.checked } })}
                        className="w-6 h-6 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor={`trans-${pattern}`} className={`text-lg font-bold flex items-center gap-2 cursor-pointer select-none ${config.transitionConfig.enabled ? 'text-indigo-700' : 'text-slate-600'}`}>
                        <Calendar className={`w-6 h-6 ${config.transitionConfig.enabled ? 'text-indigo-600' : 'text-slate-400'}`}/>
                        制度改定日
                    </label>
                </div>
                
                {config.transitionConfig.enabled && (
                    <div className="space-y-3 mt-4 animate-in slide-in-from-top-1 pl-1">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">移行基準日 (現行制度終了日)</label>
                            <div className="relative">
                                <Calendar className="w-5 h-5 absolute left-3 top-2.5 text-slate-500"/>
                                <input 
                                    type="date" 
                                    value={config.transitionConfig.date instanceof Date ? config.transitionConfig.date.toISOString().split('T')[0] : ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, transitionConfig: { ...config.transitionConfig, date: new Date(e.target.value) } })}
                                    className="w-full pl-10 p-2.5 text-base border-slate-300 rounded shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Special Modes (Only for Pattern A) */}
            {pattern === 'A' && (
                <div className="space-y-4">
                    {/* Adjustment Mode */}
                    <div className={`p-4 rounded-lg border-2 transition-colors ${config.adjustmentConfig?.enabled ? 'bg-amber-50 border-amber-500' : 'bg-slate-100 border-slate-200'}`}>
                        <div className="flex items-center gap-3">
                            <input 
                                type="checkbox" 
                                id="adj-a"
                                checked={config.adjustmentConfig?.enabled || false}
                                onChange={(e: any) => setConfig({ 
                                    ...config, 
                                    adjustmentConfig: { 
                                        enabled: e.target.checked,
                                        retirementAges: config.adjustmentConfig?.retirementAges || { type1: 65, type2: 65, type3: 65, type4: 65 }
                                    },
                                    unifyNewSystemConfig: e.target.checked ? { ...config.unifyNewSystemConfig!, enabled: false } : config.unifyNewSystemConfig
                                })}
                                className="w-6 h-6 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                            <label htmlFor="adj-a" className={`text-lg font-bold flex items-center gap-2 cursor-pointer select-none ${config.adjustmentConfig?.enabled ? 'text-amber-700' : 'text-slate-600'}`}>
                                <Lock className={`w-6 h-6 ${config.adjustmentConfig?.enabled ? 'text-amber-600' : 'text-slate-400'}`}/>
                                調整ポイントモード
                            </label>
                        </div>
                        {config.adjustmentConfig?.enabled && (
                            <div className="mt-3 space-y-2">
                                <div className="text-xs text-amber-800 bg-amber-100/50 p-2 rounded leading-relaxed">
                                    2026/3/31時点の引当金を凍結し、定年時のB案支給額との差額を「調整ポイント」として将来期間で均等割りして加算します。
                                </div>
                                <div className="bg-white p-3 rounded border border-amber-200">
                                    <label className="block text-xs font-bold text-amber-800 mb-2">適用定年年齢 (制度区分別)</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {['type1','type2','type3','type4'].map((t, i) => (
                                            <div key={t} className="flex flex-col">
                                                <span className="text-[10px] text-amber-600 font-bold text-center mb-1">{['旧①','旧②','旧③','新'][i]}</span>
                                                <select 
                                                    value={(config.adjustmentConfig?.retirementAges as any)?.[t] || 65}
                                                    onChange={(e: any) => {
                                                        const val = Number(e.target.value);
                                                        setConfig({
                                                            ...config,
                                                            adjustmentConfig: {
                                                                ...config.adjustmentConfig!,
                                                                retirementAges: {
                                                                    ...config.adjustmentConfig!.retirementAges!,
                                                                    [t]: val
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    className="text-xs border border-amber-300 rounded p-1 text-center font-bold text-amber-900 bg-amber-50 focus:ring-amber-500 focus:border-amber-500"
                                                >
                                                    <option value={60}>60歳</option>
                                                    <option value={65}>65歳</option>
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Unified New System Mode */}
                    <div className={`p-4 rounded-lg border-2 transition-colors ${config.unifyNewSystemConfig?.enabled ? 'bg-sky-50 border-sky-500' : 'bg-slate-100 border-slate-200'}`}>
                        <div className="flex items-center gap-3">
                            <input 
                                type="checkbox" 
                                id="unify-a"
                                checked={config.unifyNewSystemConfig?.enabled || false}
                                onChange={(e: any) => setConfig({ 
                                    ...config, 
                                    unifyNewSystemConfig: { 
                                        enabled: e.target.checked,
                                        retirementAges: config.unifyNewSystemConfig?.retirementAges || { type1: 65, type2: 65, type3: 65, type4: 65 },
                                        targetTypes: config.unifyNewSystemConfig?.targetTypes || { type1: false, type2: false, type3: true, type4: true }
                                    },
                                    adjustmentConfig: e.target.checked ? { ...config.adjustmentConfig!, enabled: false } : config.adjustmentConfig
                                })}
                                className="w-6 h-6 rounded text-sky-600 focus:ring-sky-500 cursor-pointer"
                            />
                            <label htmlFor="unify-a" className={`text-lg font-bold flex items-center gap-2 cursor-pointer select-none ${config.unifyNewSystemConfig?.enabled ? 'text-sky-700' : 'text-slate-600'}`}>
                                <RefreshCw className={`w-6 h-6 ${config.unifyNewSystemConfig?.enabled ? 'text-sky-600' : 'text-slate-400'}`}/>
                                新制度に統一モード
                            </label>
                        </div>
                        {config.unifyNewSystemConfig?.enabled && (
                            <div className="mt-3 space-y-2">
                                <div className="text-xs text-sky-800 bg-sky-100/50 p-2 rounded leading-relaxed">
                                    2026/3/31時点の引当金を凍結し、2026年4月以降は選択された区分の対象者を「新制度（Type4）」のポイントテーブル・計算式で積み上げ計算します。
                                </div>
                                <div className="bg-white p-3 rounded border border-sky-200">
                                    <label className="block text-xs font-bold text-sky-800 mb-2">適用対象と定年年齢</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {['type1','type2','type3','type4'].map((t, i) => {
                                            const isChecked = config.unifyNewSystemConfig?.targetTypes?.[t as 'type1'|'type2'|'type3'|'type4'] ?? true;
                                            return (
                                            <div key={t} className="flex flex-col items-center gap-1.5 p-1.5 rounded border border-slate-100 bg-slate-50">
                                                <div className="flex items-center gap-1">
                                                    <input 
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(e: any) => setConfig({
                                                            ...config,
                                                            unifyNewSystemConfig: {
                                                                ...config.unifyNewSystemConfig!,
                                                                targetTypes: {
                                                                    ...config.unifyNewSystemConfig!.targetTypes!,
                                                                    [t as 'type1'|'type2'|'type3'|'type4']: e.target.checked
                                                                }
                                                            }
                                                        })}
                                                        className="w-3.5 h-3.5 text-sky-600 rounded"
                                                    />
                                                    <span className="text-[10px] text-sky-600 font-bold">{['旧①','旧②','旧③','新'][i]}</span>
                                                </div>
                                                <select 
                                                    value={(config.unifyNewSystemConfig?.retirementAges as any)?.[t] || 65}
                                                    disabled={!isChecked}
                                                    onChange={(e: any) => {
                                                        const val = Number(e.target.value);
                                                        setConfig({
                                                            ...config,
                                                            unifyNewSystemConfig: {
                                                                ...config.unifyNewSystemConfig!,
                                                                retirementAges: {
                                                                    ...config.unifyNewSystemConfig!.retirementAges!,
                                                                    [t as 'type1'|'type2'|'type3'|'type4']: val
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    className={`text-xs border border-sky-300 rounded p-1 text-center font-bold text-sky-900 focus:ring-sky-500 focus:border-sky-500 w-full ${!isChecked ? 'opacity-50 cursor-not-allowed bg-slate-200' : 'bg-sky-50'}`}
                                                >
                                                    <option value={60}>60歳</option>
                                                    <option value={65}>65歳</option>
                                                </select>
                                            </div>
                                        )})}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 現行（改定日前）のパラメータ */}
            <div className="space-y-4">
                <h4 className="font-bold text-sm text-slate-700 border-b pb-1">{config.transitionConfig.enabled ? '改定日前（現行）のパラメータ' : 'パラメータ設定'}</h4>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">定年年齢 (歳)</label>
                    <div className="grid grid-cols-4 gap-2 sm:gap-3">
                        {['type1','type2','type3','type4'].map((t, i) => (
                            <div key={t}>
                                <span className="block text-[10px] sm:text-[11px] text-slate-400 text-center mb-0.5">{['旧制度①','旧制度②','旧制度③','新制度'][i]}</span>
                                <input 
                                    type="number" 
                                    value={(config.retirementAges as any)[t]} 
                                    onChange={(e: any) => setConfig({...config, retirementAges: {...config.retirementAges, [t]: Number(e.target.value)}})} 
                                    disabled={config.adjustmentConfig?.enabled || config.unifyNewSystemConfig?.enabled}
                                    className={`w-full p-1.5 sm:p-2 border-slate-300 rounded text-sm sm:text-base text-center ${config.adjustmentConfig?.enabled || config.unifyNewSystemConfig?.enabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">職能P 上限年数</label>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        {['type1','type2','type3'].map((t, i) => (
                            <div key={t}>
                                <span className="block text-[10px] sm:text-[11px] text-slate-400 text-center mb-0.5">{['旧制度①','旧制度②','旧制度③'][i]}</span>
                                <input 
                                    type="number" min={30} max={47}
                                    value={(config.cutoffYears as any)[t]} 
                                    onChange={(e: any) => setConfig({...config, cutoffYears: {...config.cutoffYears, [t]: Number(e.target.value)}})} 
                                    className="w-full p-1.5 sm:p-2 border-slate-300 rounded text-sm sm:text-base text-center" 
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 改定日以降（将来）のパラメータ */}
            {config.transitionConfig.enabled && (
                <div className="space-y-4 pt-4 border-t border-slate-200">
                    <h4 className="font-bold text-sm text-indigo-700 border-b pb-1">改定日以降のパラメータ</h4>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">定年年齢 (歳)</label>
                        <div className="grid grid-cols-4 gap-2 sm:gap-3">
                            {['type1','type2','type3','type4'].map((t, i) => (
                                <div key={t}>
                                    <span className="block text-[10px] sm:text-[11px] text-slate-400 text-center mb-0.5">{['旧制度①','旧制度②','旧制度③','新制度'][i]}</span>
                                    <input 
                                        type="number" 
                                        value={(config.retirementAgesFuture as any)[t]} 
                                        onChange={(e: any) => setConfig({...config, retirementAgesFuture: {...config.retirementAgesFuture, [t]: Number(e.target.value)}})} 
                                        disabled={config.adjustmentConfig?.enabled || config.unifyNewSystemConfig?.enabled}
                                        className={`w-full p-1.5 sm:p-2 border-indigo-200 rounded text-sm sm:text-base text-center ${config.adjustmentConfig?.enabled || config.unifyNewSystemConfig?.enabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-50 focus:ring-indigo-500'}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">職能P 上限年数</label>
                            <div className="grid grid-cols-3 gap-2">
                                {['type1','type2','type3'].map((t, i) => (
                                    <div key={t}>
                                        <span className="block text-[10px] sm:text-[11px] text-slate-400 text-center mb-0.5">{['旧①','旧②','旧③'][i]}</span>
                                        <input 
                                            type="number" min={30} max={47}
                                            value={(config.cutoffYearsFuture as any)[t]} 
                                            onChange={(e: any) => setConfig({...config, cutoffYearsFuture: {...config.cutoffYearsFuture, [t]: Number(e.target.value)}})} 
                                            className="w-full p-1.5 sm:p-2 border-indigo-200 rounded text-sm sm:text-base text-center bg-indigo-50 focus:ring-indigo-500" 
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">標準考課Pt (年)</label>
                            <input 
                                type="number" 
                                value={config.defaultYearlyEvalFuture} 
                                onChange={(e: any) => setConfig({...config, defaultYearlyEvalFuture: Number(e.target.value)})} 
                                className="w-full p-2 border-indigo-200 rounded text-base text-right bg-indigo-50 focus:ring-indigo-500 sm:mt-6" 
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-4 border-t border-slate-200">
                <button 
                    onClick={() => setEditingPattern(pattern as 'A' | 'B')}
                    className="w-full py-2.5 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 transition flex items-center justify-center gap-2"
                >
                    <Database className="w-4 h-4"/> 勤続P・職能P・支給率テーブルを確認・編集する
                </button>
            </div>
        </div>
    )};

    const renderAnalysisCard = (title: React.ReactNode, groupData: any, colorClass: string) => {
        if (!groupData) return (
            <div className="bg-white p-5 rounded-lg border border-slate-100 shadow-sm opacity-60 flex flex-col justify-center items-center h-full min-h-[160px]">
                <div className={`font-bold text-sm mb-2 ${colorClass} text-center`}>{title}</div>
                <div className="text-slate-300 text-sm">該当者なし</div>
            </div>
        );

        return (
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition h-full flex flex-col">
                <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-2">
                    <div className={`font-bold text-sm ${colorClass}`}>{title}</div>
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-mono shrink-0 ml-2">
                        {groupData.count} <span className="text-[10px] text-slate-400">名</span>
                    </span>
                </div>
                
                <div className="space-y-4 flex-1">
                    <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Oldest (最古参)</span>
                            <span className="text-[10px] font-mono text-slate-400">{formatDateWithWareki(groupData.oldest.date).split(' ')[0]}入社</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700 truncate" title={groupData.oldest.name}>{groupData.oldest.name}</span>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-xs text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    {groupData.oldest.age !== null ? `${groupData.oldest.age}歳` : '-'}
                                </span>
                                <span className="text-xs font-bold text-indigo-600">勤続 {groupData.oldest.years.toFixed(1)}年</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Newest (最若手)</span>
                            <span className="text-[10px] font-mono text-slate-400">{formatDateWithWareki(groupData.newest.date).split(' ')[0]}入社</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700 truncate" title={groupData.newest.name}>{groupData.newest.name}</span>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-xs text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    {groupData.newest.age !== null ? `${groupData.newest.age}歳` : '-'}
                                </span>
                                <span className="text-xs font-bold text-indigo-600">勤続 {groupData.newest.years.toFixed(1)}年</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 py-10 px-6 font-sans text-slate-800">
            <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200">
                {/* ... Header ... */}
                <div className="bg-gradient-to-r from-slate-800 to-indigo-900 px-10 py-8 flex items-center justify-between no-print">
                    <div className="flex items-center gap-5">
                        <div className="p-3.5 bg-white/10 rounded-xl backdrop-blur-sm">
                            <Calculator className="w-10 h-10 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-1">京都バス退職金試算システム 2026版</h1>
                            <div className="flex items-center gap-3">
                                <span className="text-indigo-200 text-base">比較シミュレーション版</span>
                                <span className="bg-emerald-500/20 text-emerald-300 text-sm px-2.5 py-0.5 rounded border border-emerald-500/30">A/Bパターン対応</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                         <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setShowApiSettings(true)}
                                className="bg-white/10 hover:bg-white/20 text-indigo-100 hover:text-white px-4 py-2 rounded-lg text-base flex items-center gap-2 transition no-print font-bold"
                            >
                                <Key className="w-5 h-5"/>
                                <span className="hidden sm:inline">API設定</span>
                            </button>
                            <button 
                                onClick={() => setShowHelp(true)}
                                className="bg-white/10 hover:bg-white/20 text-indigo-100 hover:text-white px-4 py-2 rounded-lg text-base flex items-center gap-2 transition no-print font-bold"
                            >
                                <HelpCircle className="w-5 h-5"/>
                                <span className="hidden sm:inline">使い方・FAQ</span>
                            </button>
                            <span className={`text-sm font-bold px-4 py-2 rounded-full border border-white/30 text-white ${status.includes('エラー') ? 'bg-red-500/50' : 'bg-white/20'}`}>
                                {status}
                            </span>
                        </div>
                        {isCalculating && (
                            <div className="w-40 bg-indigo-900/50 rounded-full h-2 overflow-hidden">
                                <div className="bg-emerald-400 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-8 space-y-10">
                    {/* Section 1: Conditions & Compare Settings */}
                    <div className="no-print">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-slate-700 flex items-center gap-3 text-xl">
                                <Sliders className="w-6 h-6 text-indigo-600" /> 計算条件の比較設定
                            </h3>
                            <div className="flex items-center gap-4">
                                {data.length > 0 && (
                                    <button 
                                        onClick={handleRunSimulation} 
                                        className="flex items-center gap-3 bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-800 text-white px-10 py-5 rounded-2xl font-bold text-2xl shadow-xl hover:shadow-2xl hover:scale-105 hover:from-indigo-500 hover:to-indigo-700 transform duration-200 transition-all border border-indigo-400/20 ring-4 ring-indigo-500/10"
                                    >
                                        <Play className="w-8 h-8 fill-current"/> 再計算する
                                    </button>
                                )}
                                {aggregatedData.length > 0 && (
                                    <button 
                                        onClick={handleCopyResults} 
                                        className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2 rounded-xl font-bold shadow-sm hover:bg-slate-50 border border-slate-200 transition-colors"
                                    >
                                        <Copy className="w-5 h-5"/> 結果をコピー
                                    </button>
                                )}
                                <button 
                                    onClick={handleSaveConfig} 
                                    className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2 rounded-xl font-bold shadow-sm hover:bg-slate-50 border border-slate-200 transition-colors"
                                    title="現在の設定をJSONファイルとして保存します"
                                >
                                    <Save className="w-5 h-5"/> 設定保存
                                </button>
                                <label 
                                    className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2 rounded-xl font-bold shadow-sm hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer"
                                    title="保存したJSONファイルから設定を読み込みます"
                                >
                                    <Upload className="w-5 h-5"/> 設定読込
                                    <input 
                                        type="file" 
                                        accept=".json" 
                                        onChange={handleLoadConfig} 
                                        className="hidden" 
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-8">
                            {renderSettingsPanel(configA, setConfigA, 'A')}
                            {renderSettingsPanel(configB, setConfigB, 'B')}
                        </div>
                    </div>

                    {/* Section 2: Data Input */}
                    <div className="border-t border-slate-200 pt-8 no-print">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center gap-4">
                                <label 
                                    className={`flex flex-col sm:flex-row items-center sm:items-start gap-4 cursor-pointer p-6 rounded-xl transition border-2 border-dashed ${isDragging ? 'bg-indigo-50 border-indigo-400' : 'bg-white border-slate-300 hover:border-indigo-300 hover:bg-slate-50'} group text-center sm:text-left`}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <div className={`p-4 rounded-full transition-transform ${isDragging ? 'bg-indigo-200 text-indigo-700 scale-110' : 'bg-indigo-100 text-indigo-600 group-hover:scale-110'}`}>
                                        <Database className="w-8 h-8"/>
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-bold text-slate-700 text-lg mb-1">社員データ読込</div>
                                        <div className="text-sm text-slate-500 mb-2">Excel (.xlsx) または CSV ファイルをドラッグ＆ドロップ、またはクリックして選択</div>
                                        <div className="inline-block bg-slate-100 px-3 py-1 rounded-full text-xs font-bold text-slate-600">
                                            現在の読込件数: <span className="text-indigo-600 text-sm">{data.length}</span> 件
                                        </div>
                                    </div>
                                    <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleDataFile} />
                                </label>
                                <div className="flex flex-wrap gap-3 justify-end items-center mt-2">
                                    {data.length > 0 && (
                                        <button 
                                            onClick={() => setShowAnalysis(!showAnalysis)}
                                            className={`mr-auto text-sm flex items-center gap-2 px-4 py-2 rounded-lg border transition font-bold ${showAnalysis ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                        >
                                            <PieChart className="w-4 h-4" /> 
                                            {showAnalysis ? '分析を隠す' : 'データ分析'}
                                        </button>
                                    )}
                                    <button onClick={handleDownloadTemplate} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-white rounded font-medium">テンプレートDL</button>
                                    <button onClick={handleLoadSampleData} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-white rounded font-medium">サンプル読込</button>
                                    <button onClick={handleClearData} className="text-sm px-3 py-1.5 text-red-500 hover:bg-red-50 rounded font-medium">クリア</button>
                                </div>
                            </div>

                            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center items-center gap-3">
                                <p className="text-sm text-slate-500 font-bold">パターンAとBの結果をまとめて出力します</p>
                                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                                    <button 
                                        onClick={() => handleCalculateAndExport('xlsx')} 
                                        disabled={isCalculating || data.length === 0}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-white shadow-md transition ${isCalculating || data.length === 0 ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                    >
                                        {isCalculating ? <Loader2 className="w-5 h-5 animate-spin"/> : <FileSpreadsheet className="w-5 h-5"/>} 
                                        Excel出力
                                    </button>
                                    <button 
                                        onClick={() => handleCalculateAndExport('csv')} 
                                        disabled={isCalculating || data.length === 0}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-white shadow-md transition ${isCalculating || data.length === 0 ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                                    >
                                        {isCalculating ? <Loader2 className="w-5 h-5 animate-spin"/> : <Download className="w-5 h-5"/>} 
                                        CSV出力
                                    </button>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <input 
                                        type="checkbox" 
                                        id="includeDetailedCsv" 
                                        checked={includeDetailedCsv} 
                                        onChange={(e) => setIncludeDetailedCsv(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <label htmlFor="includeDetailedCsv" className="text-sm text-slate-600 cursor-pointer font-medium">
                                        個人別の年度別詳細データも含める (CSV/Excel出力時)
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2.5: Analysis Panel */}
                    {showAnalysis && analysisResult && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                             <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mb-4">
                                <div className="flex justify-between items-center mb-6">
                                    <h4 className="font-bold text-slate-700 flex items-center gap-3 text-lg">
                                        <PieChart className="w-6 h-6 text-indigo-600" /> 社員データ分析レポート
                                    </h4>
                                    <div className="text-sm font-mono bg-white px-3 py-1.5 rounded border border-slate-200 text-slate-500">
                                        Total: <span className="font-bold text-indigo-600 text-base">{analysisResult.total}</span> 名
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {renderAnalysisCard(
                                        <div>旧制度区分①<div className="text-[11px] font-normal text-slate-500 mt-0.5">～1999.3 (～H11.3)</div></div>,
                                        analysisResult.type1, 
                                        "text-orange-500"
                                    )}
                                    {renderAnalysisCard(
                                        <div>旧制度区分②<div className="text-[11px] font-normal text-slate-500 mt-0.5">1999.4～2000.3 (H11.4～H12.3)</div></div>,
                                        analysisResult.type2, 
                                        "text-yellow-600"
                                    )}
                                    {renderAnalysisCard(
                                        <div>旧制度区分③<div className="text-[11px] font-normal text-slate-500 mt-0.5">2000.4～2011.9 (H12.4～H23.9)</div></div>,
                                        analysisResult.type3, 
                                        "text-emerald-600"
                                    )}
                                    {renderAnalysisCard(
                                        <div>新制度<div className="text-[11px] font-normal text-slate-500 mt-0.5">2011.10～ (H23.10～)</div></div>,
                                        analysisResult.type4, 
                                        "text-blue-500"
                                    )}
                                </div>
                                <div className="mt-4 text-xs text-slate-400 text-right">
                                    ※ 勤続年数・年齢は <span className="font-bold">{analysisResult.refDateStr.split(' ')[0]} {analysisResult.isTransitionDate ? '(制度改定日)' : ''}</span> 時点での概算です
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Section 3: Chart */}
                    <div className="border-t border-slate-200 pt-8">
                        <AnnualCostChart data={aggregatedData} />
                    </div>
                    
                    {/* Section 4: Individual Simulation */}
                    <div className="border-t border-slate-200 pt-8 print-break-inside-avoid">
                        <h3 className="font-bold text-slate-700 flex items-center gap-3 mb-6 text-lg">
                            <Search className="w-6 h-6 text-indigo-600" /> 個人別シミュレーション比較
                        </h3>
                        <div className="flex gap-3 max-w-xl mb-6 no-print">
                            <input 
                                type="text" 
                                placeholder="社員番号 または 氏名..." 
                                className="flex-1 border-slate-300 rounded-xl px-5 py-3 text-base focus:ring-2 focus:ring-indigo-500" 
                                value={searchTerm} 
                                onChange={(e: any) => setSearchTerm(e.target.value)} 
                                onKeyDown={(e) => e.key === 'Enter' && executeSearch()}
                            />
                            <button onClick={executeSearch} className="bg-indigo-600 text-white px-6 py-3 rounded-xl text-base font-bold hover:bg-indigo-700 transition">検索</button>
                        </div>
                        
                        {searchError && <div className="text-red-500 text-base bg-red-50 p-4 rounded border border-red-100"><AlertCircle className="w-5 h-5 inline mr-2"/>{searchError}</div>}
                        
                        {searchResult && (
                            <ResultCard resA={searchResult.resA} resB={searchResult.resB} />
                        )}
                    </div>
                    
                    {/* Section 5: AI Analysis Report */}
                    <div className="report-section">
                        <AIAnalysisReport data={aggregatedData} customApiKey={customApiKey} />
                    </div>

                    {/* Footer / Info */}
                    <div className="mt-10 pt-8 border-t border-slate-200 text-center text-sm text-slate-400 no-print">
                        <p>&copy; 2025 Kyoto Bus Co., Ltd. / Retirement Allowance Simulation System Ver 2.0.0 (Compare Ed.)</p>
                    </div>
                    {error && (
                        <div className="fixed bottom-6 right-6 bg-red-600 text-white p-5 rounded-xl shadow-lg flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 z-50">
                            <AlertCircle className="w-6 h-6" />
                            <div>
                                <p className="font-bold text-base">エラーが発生しました</p>
                                <p className="text-sm opacity-90">{error}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Modals */}
                {editingPattern && (
                    <MasterEditorModal 
                        pattern={editingPattern} 
                        config={editingPattern === 'A' ? configA : configB} 
                        setConfig={editingPattern === 'A' ? setConfigA : setConfigB} 
                        onClose={() => setEditingPattern(null)} 
                    />
                )}
                {showHelp && (
                    <HelpModal onClose={() => setShowHelp(false)} />
                )}
                {showApiSettings && (
                    <ApiSettingsModal 
                        onClose={() => setShowApiSettings(false)} 
                        customApiKey={customApiKey} 
                        setCustomApiKey={setCustomApiKey} 
                    />
                )}
                <ChatConsultant config={configA} aggregatedData={aggregatedData} customApiKey={customApiKey} />
            </div>
        </div>
    );
}