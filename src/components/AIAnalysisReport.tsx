import React, { useState } from 'react';
import { AggregatedYearlyData } from '../types';
import { Bot, Loader2, AlertCircle, Download, Printer } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';
import { logError } from '../utils';

interface AIAnalysisReportProps {
    data: AggregatedYearlyData[];
    customApiKey?: string;
}

export const AIAnalysisReport: React.FC<AIAnalysisReportProps> = ({ data, customApiKey }) => {
    const [report, setReport] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDownloadReport = () => {
        if (!report) return;
        const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_analysis_report_${new Date().toISOString().split('T')[0]}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handlePrintReport = () => {
        window.print();
    };

    const generateReport = async () => {
        if (!data || data.length === 0) return;
        
        setIsLoading(true);
        setError(null);
        
        try {
            const apiKey = customApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
            const ai = new GoogleGenAI({ apiKey: apiKey });
            
            const totalCostA = data.reduce((sum, d) => sum + d.A.total, 0);
            const totalCostB = data.reduce((sum, d) => sum + d.B.total, 0);
            
            const totalType1A = data.reduce((sum, d) => sum + d.A.type1, 0);
            const totalType2A = data.reduce((sum, d) => sum + d.A.type2, 0);
            const totalType3A = data.reduce((sum, d) => sum + d.A.type3, 0);
            const totalType4A = data.reduce((sum, d) => sum + d.A.type4, 0);

            const totalType1B = data.reduce((sum, d) => sum + d.B.type1, 0);
            const totalType2B = data.reduce((sum, d) => sum + d.B.type2, 0);
            const totalType3B = data.reduce((sum, d) => sum + d.B.type3, 0);
            const totalType4B = data.reduce((sum, d) => sum + d.B.type4, 0);

            const peakYearB = data.reduce((max, d) => d.B.total > max.B.total ? d : max, data[0]);
            const peakYearA = data.reduce((max, d) => d.A.total > max.A.total ? d : max, data[0]);
            const maxDiffYear = data.reduce((max, d) => Math.abs(d.A.total - d.B.total) > Math.abs(max.A.total - max.B.total) ? d : max, data[0]);
            
            const prompt = `
あなたはベテランの人事労務コンサルタントです。
特に、京都バスの退職金制度の歴史的背景（旧制度からの段階的な移行、職能給・考課給の導入経緯など）や、昨今の労働法制の改正（同一労働同一賃金、定年延長、高年齢者雇用安定法の改正など）が退職給付債務に与える潜在的な影響を深く理解しています。

以下の退職金シミュレーション結果（現行制度Bと変更案Aの比較）を分析し、経営者向けにレポートを作成してください。

【重要：単位の扱い】
- 退職金額や費用の単位は「千円」です。レポート内で金額を出す際は必ず「千円」単位であることを明記し、数値の桁数に注意してください。

【データ概要】
- 対象期間: ${data[0]?.year}年 ～ ${data[data.length - 1]?.year}年
- 現行制度(B)の総費用: ${Math.round(totalCostB).toLocaleString()} 千円
- 変更案(A)の総費用: ${Math.round(totalCostA).toLocaleString()} 千円
- 差額(A - B): ${Math.round(totalCostA - totalCostB).toLocaleString()} 千円

【制度区分別の総費用内訳（千円）】
- 現行制度(B): 旧制度① ${Math.round(totalType1B).toLocaleString()}, 旧制度② ${Math.round(totalType2B).toLocaleString()}, 旧制度③ ${Math.round(totalType3B).toLocaleString()}, 新制度 ${Math.round(totalType4B).toLocaleString()}
- 変更案(A): 旧制度① ${Math.round(totalType1A).toLocaleString()}, 旧制度② ${Math.round(totalType2A).toLocaleString()}, 旧制度③ ${Math.round(totalType3A).toLocaleString()}, 新制度 ${Math.round(totalType4A).toLocaleString()}

【キャッシュフロー・財務リスク指標】
- 現行制度(B)の支出ピーク年: ${peakYearB.year}年 (${Math.round(peakYearB.B.total).toLocaleString()} 千円)
- 変更案(A)の支出ピーク年: ${peakYearA.year}年 (${Math.round(peakYearA.A.total).toLocaleString()} 千円)
- 制度変更による単年度の最大乖離年: ${maxDiffYear.year}年 (差額: ${Math.round(maxDiffYear.A.total - maxDiffYear.B.total).toLocaleString()} 千円)

レポートには以下の内容を含めてください：
1. 全体的なコストインパクトと制度区分別の影響分析（どの層に最も影響が出ているか）
2. 将来のキャッシュフロー推移と財務リスクの評価（ピーク時の負担や資金繰りへの影響）
3. 制度変更によるメリット・デメリットの深い考察
4. 経営課題としての今後の対応方針（移行措置の必要性など）
5. コスト削減と従業員定着率（リテンション）の向上を両立させるための、具体的な退職金制度の変更提案

Markdown形式で見出しや箇条書きを使って分かりやすく記述してください。
`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: prompt,
            });
            
            setReport(response.text || 'レポートを生成できませんでした。');
        } catch (err: any) {
            logError("AI Analysis Error", err, { dataLength: data.length });
            setError(err.message || 'レポートの生成中にエラーが発生しました。');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mt-8">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Bot className="w-6 h-6 text-indigo-600" />
                    AI 分析レポート
                </h3>
                <div className="flex items-center gap-2">
                    {report && (
                        <>
                            <button
                                onClick={handleDownloadReport}
                                className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="レポートをダウンロード"
                            >
                                <Download className="w-5 h-5" />
                            </button>
                            <button
                                onClick={handlePrintReport}
                                className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="レポートを印刷/PDF保存"
                            >
                                <Printer className="w-5 h-5" />
                            </button>
                        </>
                    )}
                    <button
                        onClick={generateReport}
                        disabled={isLoading || data.length === 0}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                        {report ? '再生成' : 'レポートを生成'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 flex items-center gap-2 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {report ? (
                <div className="markdown-body prose prose-slate max-w-none">
                    <Markdown>{report}</Markdown>
                </div>
            ) : !isLoading && !error ? (
                <div className="text-center py-12 text-slate-500">
                    <Bot className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                    <p>上のボタンをクリックして、AIによるシミュレーション結果の分析レポートを生成します。</p>
                </div>
            ) : null}
            
            {isLoading && (
                <div className="text-center py-12 text-slate-500">
                    <Loader2 className="w-12 h-12 mx-auto text-indigo-400 animate-spin mb-3" />
                    <p>AIがデータを分析し、レポートを作成しています...</p>
                </div>
            )}
        </div>
    );
};
