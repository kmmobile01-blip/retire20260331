import React, { useState, useEffect } from 'react';
import { X, Key } from 'lucide-react';

interface ApiSettingsModalProps {
    onClose: () => void;
    customApiKey: string;
    setCustomApiKey: (key: string) => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ onClose, customApiKey, setCustomApiKey }) => {
    const [tempKey, setTempKey] = useState(customApiKey);

    const handleSave = () => {
        setCustomApiKey(tempKey);
        localStorage.setItem('custom_gemini_api_key', tempKey);
        onClose();
    };

    const handleClear = () => {
        setTempKey('');
        setCustomApiKey('');
        localStorage.removeItem('custom_gemini_api_key');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Key className="w-5 h-5 text-indigo-600" />
                        APIキー設定
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-600">
                        独自のGemini APIキーを設定できます。設定しない場合は、システムに組み込まれた標準のAPIが使用されます。
                    </p>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Gemini API Key</label>
                        <input 
                            type="password" 
                            value={tempKey} 
                            onChange={(e) => setTempKey(e.target.value)}
                            placeholder="AIzaSy..."
                            className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <button onClick={handleClear} className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            クリア
                        </button>
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                            キャンセル
                        </button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm">
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
