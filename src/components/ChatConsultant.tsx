import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, User, Bot, Loader2, Minimize2, Maximize2, Settings, Download, Maximize, Minimize } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';
import { SimulationConfig, AggregatedYearlyData } from '../types';
import { logError } from '../utils';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface ChatConsultantProps {
  config: SimulationConfig;
  aggregatedData: AggregatedYearlyData[];
  customApiKey?: string;
  onApplyConfig?: (config: Partial<SimulationConfig>) => void;
}

export const ChatConsultant: React.FC<ChatConsultantProps> = ({ config, aggregatedData, customApiKey, onApplyConfig }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLarge, setIsLarge] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<Partial<SimulationConfig> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'こんにちは。人事労務コンサルタントのAIアシスタントです。\n\n退職金制度の一般論、現行制度の課題、シミュレーション結果の分析、改定案の提案などについて、何でもご相談ください。' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isOpen, isMinimized]);

  const handleDownloadChat = () => {
    const chatText = messages.map(m => `[${m.role === 'user' ? '相談者' : 'AIコンサルタント'}]\n${m.text}\n`).join('\n---\n\n');
    const blob = new Blob([chatText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_history_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSend = async (textToSend?: string) => {
    const userText = (textToSend || input).trim();
    if (!userText || isLoading) return;

    if (!textToSend) setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      // Calculate basic stats for context
      const totalCostA = aggregatedData.reduce((sum, d) => sum + d.A.total, 0);
      const totalCostB = aggregatedData.reduce((sum, d) => sum + d.B.total, 0);
      const diff = totalCostB - totalCostA;
      const currentYear = new Date().getFullYear();
      const next10YearsA = aggregatedData.filter(d => d.year >= currentYear && d.year < currentYear + 10).reduce((sum, d) => sum + d.A.total, 0);
      const next10YearsB = aggregatedData.filter(d => d.year >= currentYear && d.year < currentYear + 10).reduce((sum, d) => sum + d.B.total, 0);

      const contextSummary = `
【現在のシミュレーション設定・結果のサマリー】
- 調整設定(変更案): ${config.adjustmentConfig?.enabled ? '有効' : '無効'}
- 新制度統一(変更案): ${config.unifyNewSystemConfig?.enabled ? '有効' : '無効'}
- 対象従業員数: ${aggregatedData.length > 0 ? aggregatedData[0].counts.total : 0}名
- 総費用（現行制度B）: ${Math.round(totalCostB).toLocaleString()} 千円
- 総費用（変更案A）: ${Math.round(totalCostA).toLocaleString()} 千円
- 差額（A - B）: ${Math.round(totalCostA - totalCostB).toLocaleString()} 千円
- 今後10年間の費用（現行制度B）: ${Math.round(next10YearsB).toLocaleString()} 千円
- 今後10年間の費用（変更案A）: ${Math.round(next10YearsA).toLocaleString()} 千円
`;

      const systemInstruction = `あなたはベテランの人事労務コンサルタントです。退職金制度（旧制度・新制度・移行措置など）の専門家として、ユーザーの相談に乗ります。
特に、京都バスの退職金制度の歴史的背景（旧制度からの段階的な移行、職能給・考課給の導入経緯など）や、昨今の労働法制の改正（同一労働同一賃金、定年延長、高年齢者雇用安定法の改正など）が退職給付債務に与える潜在的な影響を深く理解しています。
以下の現在のシミュレーション状況も踏まえて、プロフェッショナルかつ分かりやすく、具体的なアドバイスを提供してください。
また、コスト削減と従業員の定着率向上（リテンション）の両立に焦点を当て、シミュレーション結果と労働法制の分析に基づいた具体的な制度変更の提案を積極的に行ってください。

【重要：単位と数値の扱い】
- 退職金額や費用の単位は「千円」です。回答内で金額を出す際は必ず「千円」単位であることを明記し、数値の桁数に注意してください。
- ポイント単価は通常「1,000円」や「1,200円」などの絶対値です。
- 支給率は「1.0」や「0.8」などの係数です。

【重要：設定の自動反映】
もし具体的なパラメータ（定年年齢、ポイント単価、頭打ち年数など）の変更を提案する場合、回答の最後に以下の形式のJSONブロックを含めてください。これによりユーザーがワンクリックで設定を反映できるようになります。
JSONには変更したいプロパティのみを含めてください。

\`\`\`json
{
  "type": "PROPOSAL",
  "config": {
    "unitPrice": 1100,
    "retirementAgesFuture": { "type1": 65, "type2": 65, "type3": 65, "type4": 65 },
    "cutoffYearsFuture": { "type1": 40, "type2": 40, "type3": 40 }
  }
}
\`\`\`

回答はMarkdown形式で、適宜見出しや箇条書きを使って読みやすくしてください。

${contextSummary}
`;

      const contents = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));
      contents.push({ role: 'user', parts: [{ text: userText }] });

      const apiKey = customApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: apiKey });

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });

      setMessages(prev => [...prev, { role: 'model', text: '' }]);

      let fullText = '';
      for await (const chunk of responseStream) {
        fullText += chunk.text;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].text = fullText;
          return newMessages;
        });
      }

      // Parse for proposal JSON
      const jsonMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.type === 'PROPOSAL' && parsed.config) {
            setPendingConfig(parsed.config);
          }
        } catch (e) {
          console.error("Failed to parse proposal JSON", e);
        }
      }
    } catch (error: any) {
      logError("Chat error", error, { messageLength: input.length });
      setMessages(prev => [...prev, { role: 'model', text: '申し訳ありません。エラーが発生しました。もう一度お試しください。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApplyConfig = () => {
    if (pendingConfig && onApplyConfig) {
      onApplyConfig(pendingConfig);
      setMessages(prev => [...prev, { role: 'model', text: '提案された設定をシミュレーション（変更案A）に反映しました。グラフを確認してください。' }]);
      setPendingConfig(null);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-xl transition-transform hover:scale-105 z-50 flex items-center gap-2"
      >
        <MessageCircle size={24} />
        <span className="font-medium pr-2">コンサルタントに相談</span>
      </button>
    );
  }

  return (
    <div className={`fixed right-6 z-50 flex flex-col bg-white rounded-xl shadow-2xl border border-gray-200 transition-all duration-300 ${isMinimized ? 'bottom-6 h-14 w-80' : isLarge ? 'bottom-6 h-[800px] max-h-[90vh] w-[600px] max-w-[95vw]' : 'bottom-6 h-[600px] max-h-[80vh] w-[400px] max-w-[90vw]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-blue-600 text-white rounded-t-xl cursor-pointer" onClick={() => setIsMinimized(!isMinimized)}>
        <div className="flex items-center gap-2">
          <Bot size={20} />
          <h3 className="font-bold text-sm">人事労務コンサルタント</h3>
        </div>
        <div className="flex items-center gap-1">
          {!isMinimized && (
            <button 
              onClick={(e) => { e.stopPropagation(); handleDownloadChat(); }}
              className="p-1 hover:bg-blue-700 rounded transition-colors"
              title="チャット履歴をダウンロード"
            >
              <Download size={16} />
            </button>
          )}
          {!isMinimized && (
            <button 
              onClick={(e) => { e.stopPropagation(); setIsLarge(!isLarge); }}
              className="p-1 hover:bg-blue-700 rounded transition-colors"
              title={isLarge ? "縮小" : "拡大"}
            >
              {isLarge ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
          <button 
            onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
            className="p-1 hover:bg-blue-700 rounded transition-colors"
          >
            {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            className="p-1 hover:bg-blue-700 rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[85%] gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    ) : (
                      <div className="markdown-body prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-100 prose-pre:text-gray-800">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-2 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="p-3 rounded-2xl bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-blue-600" />
                    <span className="text-xs text-gray-500">入力中...</span>
                  </div>
                </div>
              </div>
            )}
            {pendingConfig && (
              <div className="flex justify-center my-4 animate-in fade-in zoom-in duration-300">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm flex flex-col items-center gap-3 max-w-[90%]">
                  <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
                    <Settings size={18} />
                    <span>AIからの設定変更提案があります</span>
                  </div>
                  <p className="text-xs text-blue-600 text-center">
                    この提案を「変更案A」のシミュレーション設定に自動反映しますか？
                  </p>
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => setPendingConfig(null)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      無視する
                    </button>
                    <button
                      onClick={handleApplyConfig}
                      className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      設定を反映する
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested Prompts */}
          {messages.length === 1 && !isLoading && (
            <div className="px-4 pb-3 bg-gray-50 flex flex-col gap-2 border-b border-gray-200">
              <p className="text-xs text-gray-500 font-medium">おすすめの質問:</p>
              <div className="flex flex-col gap-2">
                {[
                  "現在のシミュレーション設定（定年年齢の引き上げやポイント単価など）が、将来の退職金債務（DBO）に与える影響について詳細に解説してください。",
                  "定年延長に伴う退職金制度の移行措置について、一般的な手法を教えてください。",
                  "現行のシミュレーション結果から読み取れる、財務上のリスクは何ですか？"
                ].map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(prompt)}
                    className="text-left text-xs bg-white border border-blue-200 text-blue-700 p-2 rounded-lg hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-3 bg-white border-t border-gray-200 rounded-b-xl">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力... (Shift+Enterで改行)"
                className="flex-1 resize-none border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[44px] max-h-[120px]"
                rows={1}
                disabled={isLoading}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg px-4 flex items-center justify-center transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
            <div className="text-center mt-2">
              <span className="text-[10px] text-gray-400">AIは不正確な情報を提供することがあります。</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
