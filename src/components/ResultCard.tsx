import React, { useState } from 'react';
import { CalculationResult } from '../types';
import { ArrowRightCircle, Calendar, Users, ChevronDown, ChevronUp, Download, Info } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ResultCardProps {
    resA: CalculationResult;
    resB: CalculationResult;
}

export const ResultCard: React.FC<ResultCardProps> = ({ resA, resB }) => {
    const [showDetails, setShowDetails] = useState(false);
    const diff = resA.retirementAllowance - resB.retirementAllowance;
    const diffClass = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-600';

    const handleDownloadExcel = () => {
        const wb = XLSX.utils.book_new();

        const headers = ['年度', '年齢', '勤続Pt', '職能Pt', '考課Pt', '調整Pt', '累計Pt', '支給率', '単年度増加額(千円)'];

        // パターンAのシート
        const wsA_data = [
            headers,
            ...resA.yearlyDetails.map(d => [
                d.year, d.age, d.losPtInc, d.rankPtInc, d.evalPtInc, d.adjustmentPtInc, d.totalPt, d.coef, Math.round(d.amountInc)
            ])
        ];
        const wsA = XLSX.utils.aoa_to_sheet(wsA_data);
        XLSX.utils.book_append_sheet(wb, wsA, 'パターンA (変更案)');

        // パターンBのシート
        const wsB_data = [
            headers,
            ...resB.yearlyDetails.map(d => [
                d.year, d.age, d.losPtInc, d.rankPtInc, d.evalPtInc, d.adjustmentPtInc, d.totalPt, d.coef, Math.round(d.amountInc)
            ])
        ];
        const wsB = XLSX.utils.aoa_to_sheet(wsB_data);
        XLSX.utils.book_append_sheet(wb, wsB, 'パターンB (現行制度)');

        XLSX.writeFile(wb, `退職金明細_${resB.employeeId}_${resB.name}.xlsx`);
    };

    const renderDetailTable = (res: CalculationResult, title: string) => (
        <div className="mt-4">
            <h4 className="font-bold text-slate-700 mb-2">{title}</h4>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-500 border-collapse">
                    <thead className="text-xs text-slate-700 bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-4 py-2 border-r border-slate-200">年度</th>
                            <th className="px-4 py-2 border-r border-slate-200">年齢</th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right">勤続Pt</th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right">職能Pt</th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right">考課Pt</th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right">調整Pt</th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right font-bold text-indigo-600 relative group cursor-help">
                                <div className="flex items-center justify-end gap-1">
                                    累計Pt
                                    <Info className="w-3 h-3 text-indigo-400" />
                                </div>
                                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-xs rounded shadow-lg z-10 text-left font-normal">
                                    前年度までの累計Ptに、当年度の各ポイント（勤続・職能・考課・調整）を加算した合計値です。
                                    <div className="absolute top-full right-4 border-4 border-transparent border-t-slate-800"></div>
                                </div>
                            </th>
                            <th className="px-4 py-2 border-r border-slate-200 text-right">支給率</th>
                            <th className="px-4 py-2 text-right">増加額(千円)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {res.yearlyDetails.map((d, idx) => (
                            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-2 border-r border-slate-100">{d.year}</td>
                                <td className="px-4 py-2 border-r border-slate-100">{d.age}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right">{d.losPtInc}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right">{d.rankPtInc}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right">{d.evalPtInc}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right">{d.adjustmentPtInc}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right font-bold text-indigo-600">{d.totalPt}</td>
                                <td className="px-4 py-2 border-r border-slate-100 text-right">{d.coef.toFixed(2)}</td>
                                <td className="px-4 py-2 text-right">{Math.round(d.amountInc).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-center mb-4 border-b pb-4">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Users className="w-6 h-6 text-indigo-600" />
                        {resB.name} <span className="text-sm font-normal text-slate-500">({resB.employeeId})</span>
                    </h3>
                    <div className="text-sm text-slate-500 mt-1">
                        {resB.typeName} / {resB.grade} / 勤続 {resB.serviceDuration.years}年{resB.serviceDuration.months}ヶ月
                    </div>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                    <div className="text-sm text-slate-500">退職予定日</div>
                    <div className="font-bold text-slate-700 flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {resB.retirementDate.toLocaleDateString('ja-JP')}
                    </div>
                    <button 
                        onClick={handleDownloadExcel}
                        className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-100 transition-colors border border-emerald-200"
                    >
                        <Download className="w-3 h-3" />
                        明細Excel
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="text-sm font-bold text-slate-500 mb-2">現行制度 (パターンB)</div>
                    <div className="text-2xl font-bold text-slate-800">
                        {Math.round(resB.retirementAllowance).toLocaleString()} <span className="text-sm font-normal">千円</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-2 flex flex-wrap items-center gap-y-1 gap-x-4">
                        <div className="font-semibold text-slate-600">累計ポイント: {Math.round(resB.totalPointsAtRetirement).toLocaleString()} pt</div>
                        <div className="flex flex-wrap gap-x-3 text-slate-400 border-l border-slate-200 pl-4">
                            <span>勤続: {Math.round(resB.totalLosPoints).toLocaleString()}</span>
                            <span>職能: {Math.round(resB.totalRankPoints).toLocaleString()}</span>
                            <span>考課: {Math.round(resB.totalEvalPoints).toLocaleString()}</span>
                            <span>調整: {Math.round(resB.totalAdjustmentPoints).toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-center">
                    <ArrowRightCircle className="w-8 h-8 text-slate-300" />
                </div>

                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                    <div className="text-sm font-bold text-indigo-600 mb-2">変更案 (パターンA)</div>
                    <div className="text-2xl font-bold text-indigo-900">
                        {Math.round(resA.retirementAllowance).toLocaleString()} <span className="text-sm font-normal">千円</span>
                    </div>
                    <div className="text-xs text-indigo-500 mt-2 flex flex-wrap items-center gap-y-1 gap-x-4">
                        <div className="font-semibold text-indigo-600">累計ポイント: {Math.round(resA.totalPointsAtRetirement).toLocaleString()} pt</div>
                        <div className="flex flex-wrap gap-x-3 text-indigo-400 border-l border-indigo-200 pl-4">
                            <span>勤続: {Math.round(resA.totalLosPoints).toLocaleString()}</span>
                            <span>職能: {Math.round(resA.totalRankPoints).toLocaleString()}</span>
                            <span>考課: {Math.round(resA.totalEvalPoints).toLocaleString()}</span>
                            <span>調整: {Math.round(resA.totalAdjustmentPoints).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
                <div className="text-sm font-bold text-slate-600">差額 (A - B)</div>
                <div className={`text-xl font-bold ${diffClass}`}>
                    {diff > 0 ? '+' : ''}{Math.round(diff).toLocaleString()} <span className="text-sm font-normal">千円</span>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
                <button 
                    onClick={() => setShowDetails(!showDetails)}
                    className="flex items-center justify-center w-full gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors py-2 bg-slate-50 hover:bg-indigo-50 rounded-lg"
                >
                    {showDetails ? (
                        <><ChevronUp className="w-4 h-4" /> 年別・ポイント別明細を閉じる</>
                    ) : (
                        <><ChevronDown className="w-4 h-4" /> 年別・ポイント別明細を表示</>
                    )}
                </button>

                {showDetails && (
                    <div className="mt-4 space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                        {renderDetailTable(resA, 'パターンA (変更案) の明細')}
                        {renderDetailTable(resB, 'パターンB (現行制度) の明細')}
                    </div>
                )}
            </div>
        </div>
    );
};
