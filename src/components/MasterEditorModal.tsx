import React, { useState } from 'react';
import { SimulationConfig, TableRowT1, TableRowT2, CoefRow } from '../types';
import { logError } from '../utils';
import { X, Download, Upload, FileSpreadsheet, Edit3 } from 'lucide-react';
import * as XLSX from 'xlsx';

interface MasterEditorModalProps {
    pattern: 'A' | 'B';
    config: SimulationConfig;
    setConfig: React.Dispatch<React.SetStateAction<SimulationConfig>>;
    onClose: () => void;
}

export const MasterEditorModal: React.FC<MasterEditorModalProps> = ({ pattern, config, setConfig, onClose }) => {
    const [activeTab, setActiveTab] = useState<string>('masterData2');
    
    const handleDownloadTemplate = () => {
        const wb = XLSX.utils.book_new();
        
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterData1_1), "旧制度1");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterData1_2), "旧制度2");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterData1_3), "旧制度3");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterData2), "新制度");
        
        const coefData = config.coefSettings.type1.map((_, i) => ({
            years: config.coefSettings.type1[i].years,
            type1: config.coefSettings.type1[i].coef,
            type2: config.coefSettings.type2[i].coef,
            type3: config.coefSettings.type3[i].coef,
            type4: config.coefSettings.type4[i].coef,
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coefData), "支給率");

        if (pattern === 'A') {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterDataFuture.type1), "移行後_旧制度1");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterDataFuture.type2), "移行後_旧制度2");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterDataFuture.type3), "移行後_旧制度3");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(config.masterDataFuture.type4), "移行後_新制度");
            
            const coefFutureData = config.coefSettingsFuture.type1.map((_, i) => ({
                years: config.coefSettingsFuture.type1[i].years,
                type1: config.coefSettingsFuture.type1[i].coef,
                type2: config.coefSettingsFuture.type2[i].coef,
                type3: config.coefSettingsFuture.type3[i].coef,
                type4: config.coefSettingsFuture.type4[i].coef,
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coefFutureData), "移行後_支給率");
        }

        XLSX.writeFile(wb, `マスタデータ_テンプレート_パターン${pattern}.xlsx`);
    };

    const handleUploadExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                
                const newConfig = { ...config };
                
                if (wb.SheetNames.includes("旧制度1")) newConfig.masterData1_1 = XLSX.utils.sheet_to_json(wb.Sheets["旧制度1"]);
                if (wb.SheetNames.includes("旧制度2")) newConfig.masterData1_2 = XLSX.utils.sheet_to_json(wb.Sheets["旧制度2"]);
                if (wb.SheetNames.includes("旧制度3")) newConfig.masterData1_3 = XLSX.utils.sheet_to_json(wb.Sheets["旧制度3"]);
                if (wb.SheetNames.includes("新制度")) newConfig.masterData2 = XLSX.utils.sheet_to_json(wb.Sheets["新制度"]);
                
                if (wb.SheetNames.includes("支給率")) {
                    const coefData: any[] = XLSX.utils.sheet_to_json(wb.Sheets["支給率"]);
                    newConfig.coefSettings = {
                        type1: coefData.map(d => ({ years: d.years, coef: d.type1 })),
                        type2: coefData.map(d => ({ years: d.years, coef: d.type2 })),
                        type3: coefData.map(d => ({ years: d.years, coef: d.type3 })),
                        type4: coefData.map(d => ({ years: d.years, coef: d.type4 })),
                    };
                }

                if (pattern === 'A') {
                    if (wb.SheetNames.includes("移行後_旧制度1")) newConfig.masterDataFuture.type1 = XLSX.utils.sheet_to_json(wb.Sheets["移行後_旧制度1"]);
                    if (wb.SheetNames.includes("移行後_旧制度2")) newConfig.masterDataFuture.type2 = XLSX.utils.sheet_to_json(wb.Sheets["移行後_旧制度2"]);
                    if (wb.SheetNames.includes("移行後_旧制度3")) newConfig.masterDataFuture.type3 = XLSX.utils.sheet_to_json(wb.Sheets["移行後_旧制度3"]);
                    if (wb.SheetNames.includes("移行後_新制度")) newConfig.masterDataFuture.type4 = XLSX.utils.sheet_to_json(wb.Sheets["移行後_新制度"]);
                    
                    if (wb.SheetNames.includes("移行後_支給率")) {
                        const coefData: any[] = XLSX.utils.sheet_to_json(wb.Sheets["移行後_支給率"]);
                        newConfig.coefSettingsFuture = {
                            type1: coefData.map(d => ({ years: d.years, coef: d.type1 })),
                            type2: coefData.map(d => ({ years: d.years, coef: d.type2 })),
                            type3: coefData.map(d => ({ years: d.years, coef: d.type3 })),
                            type4: coefData.map(d => ({ years: d.years, coef: d.type4 })),
                        };
                    }
                }

                newConfig.masterDataSource = 'custom';
                setConfig(newConfig);
                alert('マスタデータを読み込みました。');
            } catch (err) {
                logError('Failed to load master data file', err, { fileName: file.name, fileSize: file.size, fileType: file.type });
                alert('ファイルの読み込みに失敗しました。テンプレートと同じ形式か確認してください。');
            }
        };
        reader.readAsBinaryString(file);
        e.target.value = ''; // reset
    };

    const handleTableChange = (tab: string, rowIndex: number, field: string, value: number) => {
        const newConfig = { ...config };
        newConfig.masterDataSource = 'manual';

        if (tab === 'masterData1_1') newConfig.masterData1_1[rowIndex] = { ...newConfig.masterData1_1[rowIndex], [field]: value };
        if (tab === 'masterData1_2') newConfig.masterData1_2[rowIndex] = { ...newConfig.masterData1_2[rowIndex], [field]: value };
        if (tab === 'masterData1_3') newConfig.masterData1_3[rowIndex] = { ...newConfig.masterData1_3[rowIndex], [field]: value };
        if (tab === 'masterData2') newConfig.masterData2[rowIndex] = { ...newConfig.masterData2[rowIndex], [field]: value };
        
        if (tab === 'coefSettings') {
            const coefField = field as 'type1' | 'type2' | 'type3' | 'type4';
            newConfig.coefSettings[coefField][rowIndex] = { ...newConfig.coefSettings[coefField][rowIndex], coef: value };
        }

        if (pattern === 'A') {
            if (tab === 'masterDataFuture_type1') newConfig.masterDataFuture.type1[rowIndex] = { ...newConfig.masterDataFuture.type1[rowIndex], [field]: value };
            if (tab === 'masterDataFuture_type2') newConfig.masterDataFuture.type2[rowIndex] = { ...newConfig.masterDataFuture.type2[rowIndex], [field]: value };
            if (tab === 'masterDataFuture_type3') newConfig.masterDataFuture.type3[rowIndex] = { ...newConfig.masterDataFuture.type3[rowIndex], [field]: value };
            if (tab === 'masterDataFuture_type4') newConfig.masterDataFuture.type4[rowIndex] = { ...newConfig.masterDataFuture.type4[rowIndex], [field]: value };
            
            if (tab === 'coefSettingsFuture') {
                const coefField = field as 'type1' | 'type2' | 'type3' | 'type4';
                newConfig.coefSettingsFuture[coefField][rowIndex] = { ...newConfig.coefSettingsFuture[coefField][rowIndex], coef: value };
            }
        }

        setConfig(newConfig);
    };

    const renderTable = (data: any[], columns: { key: string, label: string }[], tab: string) => {
        return (
            <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-lg">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            {columns.map(col => (
                                <th key={col.key} className="px-3 py-2 text-left font-bold text-slate-600 border-b border-slate-200">
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {data.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                                {columns.map(col => (
                                    <td key={col.key} className="px-3 py-1 border-r border-slate-100 last:border-r-0">
                                        {col.key === 'y' || col.key === 'years' ? (
                                            <span className="text-slate-500 font-mono">{row[col.key]}</span>
                                        ) : (
                                            <input
                                                type="number"
                                                value={row[col.key] || 0}
                                                onChange={(e) => handleTableChange(tab, i, col.key, Number(e.target.value))}
                                                className="w-full p-1 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-right font-mono"
                                            />
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderCoefTable = (settings: any, tab: string) => {
        const data = settings.type1.map((_: any, i: number) => ({
            years: settings.type1[i].years,
            type1: settings.type1[i].coef,
            type2: settings.type2[i].coef,
            type3: settings.type3[i].coef,
            type4: settings.type4[i].coef,
        }));
        const columns = [
            { key: 'years', label: '勤続年数' },
            { key: 'type1', label: '旧制度1' },
            { key: 'type2', label: '旧制度2' },
            { key: 'type3', label: '旧制度3' },
            { key: 'type4', label: '新制度' },
        ];
        return renderTable(data, columns, tab);
    };

    const tabs = [
        { id: 'masterData2', label: '新制度' },
        { id: 'masterData1_1', label: '旧制度1' },
        { id: 'masterData1_2', label: '旧制度2' },
        { id: 'masterData1_3', label: '旧制度3' },
        { id: 'coefSettings', label: '支給率' },
    ];

    if (pattern === 'A') {
        tabs.push(
            { id: 'masterDataFuture_type4', label: '移行後_新制度' },
            { id: 'masterDataFuture_type1', label: '移行後_旧制度1' },
            { id: 'masterDataFuture_type2', label: '移行後_旧制度2' },
            { id: 'masterDataFuture_type3', label: '移行後_旧制度3' },
            { id: 'coefSettingsFuture', label: '移行後_支給率' }
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-slate-200">
                    <h2 className="text-xl font-bold text-slate-800">
                        マスタ編集 - パターン{pattern}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                    <div className="mb-6">
                        <label className="block text-sm font-bold text-slate-700 mb-2">マスタデータ設定方法</label>
                        <select 
                            value={config.masterDataSource || 'default'} 
                            onChange={(e) => setConfig({...config, masterDataSource: e.target.value as 'default' | 'custom' | 'manual'})}
                            className="w-full p-3 border border-slate-300 rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="default">システム標準設定を使用</option>
                            <option value="custom">スプレッドシート(Excel)から読み込み</option>
                            <option value="manual">画面上で直接編集する</option>
                        </select>
                    </div>

                    {config.masterDataSource === 'custom' && (
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm mb-6 animate-in fade-in slide-in-from-top-2">
                            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                                カスタムマスタの読み込み
                            </h3>
                            <p className="text-sm text-slate-600 mb-6">
                                勤続ポイント、職能ポイント、支給率テーブルなどをExcelで編集できます。<br/>
                                まずテンプレートをダウンロードし、数値を編集してからアップロードしてください。
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button 
                                    onClick={handleDownloadTemplate} 
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 font-bold text-slate-700 transition"
                                >
                                    <Download className="w-5 h-5" />
                                    テンプレートDL
                                </button>
                                <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg shadow-sm hover:bg-emerald-700 font-bold cursor-pointer transition">
                                    <Upload className="w-5 h-5" />
                                    Excelアップロード
                                    <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleUploadExcel} />
                                </label>
                            </div>
                        </div>
                    )}

                    {config.masterDataSource === 'manual' && (
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-6 animate-in fade-in slide-in-from-top-2">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Edit3 className="w-5 h-5 text-indigo-600" />
                                マスタデータ直接編集
                            </h3>
                            
                            <div className="flex overflow-x-auto mb-4 border-b border-slate-200">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`px-4 py-2 font-bold text-sm whitespace-nowrap border-b-2 transition-colors ${
                                            activeTab === tab.id 
                                                ? 'border-indigo-600 text-indigo-600' 
                                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {activeTab === 'masterData2' && renderTable(config.masterData2, [
                                { key: 'y', label: '年' }, { key: 'los', label: '勤続' }, { key: 'r1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterData2')}
                            
                            {activeTab === 'masterData1_1' && renderTable(config.masterData1_1, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterData1_1')}
                            
                            {activeTab === 'masterData1_2' && renderTable(config.masterData1_2, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterData1_2')}
                            
                            {activeTab === 'masterData1_3' && renderTable(config.masterData1_3, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterData1_3')}

                            {activeTab === 'coefSettings' && renderCoefTable(config.coefSettings, 'coefSettings')}

                            {pattern === 'A' && activeTab === 'masterDataFuture_type4' && renderTable(config.masterDataFuture.type4, [
                                { key: 'y', label: '年' }, { key: 'los', label: '勤続' }, { key: 'r1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterDataFuture_type4')}
                            
                            {pattern === 'A' && activeTab === 'masterDataFuture_type1' && renderTable(config.masterDataFuture.type1, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterDataFuture_type1')}
                            
                            {pattern === 'A' && activeTab === 'masterDataFuture_type2' && renderTable(config.masterDataFuture.type2, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterDataFuture_type2')}
                            
                            {pattern === 'A' && activeTab === 'masterDataFuture_type3' && renderTable(config.masterDataFuture.type3, [
                                { key: 'y', label: '年' }, { key: 'los1', label: '勤続' }, { key: 'r1_1', label: '係員' }, { key: 'r2', label: '主任' }, { key: 'r3', label: '係長' }, { key: 'r4', label: '課長' }, { key: 'r5', label: '次長' }, { key: 'r6', label: '部長' }
                            ], 'masterDataFuture_type3')}

                            {pattern === 'A' && activeTab === 'coefSettingsFuture' && renderCoefTable(config.coefSettingsFuture, 'coefSettingsFuture')}
                        </div>
                    )}

                    {config.masterDataSource === 'default' && (
                        <div className="bg-slate-100 p-4 rounded-lg border border-slate-200 text-sm font-mono overflow-auto max-h-64">
                            <p className="text-slate-500 mb-2 font-bold">現在の「新制度」マスタデータプレビュー:</p>
                            <pre className="text-xs">{JSON.stringify(config.masterData2.slice(0, 5), null, 2)}...</pre>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-slate-200 flex justify-end">
                    <button onClick={onClose} className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2 rounded-lg font-bold transition-colors">
                        完了
                    </button>
                </div>
            </div>
        </div>
    );
};
