import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, User, Bot, Loader2, Minimize2, Maximize2 } from 'lucide-react';
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
}

export const ChatConsultant: React.FC<ChatConsultantProps> = ({ config, aggregatedData, customApiKey }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
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
    <div className={`fixed right-6 z-50 flex flex-col bg-white rounded-xl shadow-2xl border border-gray-200 transition-all duration-300 ${isMinimized ? 'bottom-6 h-14 w-80' : 'bottom-6 h-[600px] max-h-[80vh] w-[400px] max-w-[90vw]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-blue-600 text-white rounded-t-xl cursor-pointer" onClick={() => setIsMinimized(!isMinimized)}>
        <div className="flex items-center gap-2">
          <Bot size={20} />
          <h3 className="font-bold text-sm">人事労務コンサルタント</h3>
        </div>
        <div className="flex items-center gap-1">
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
