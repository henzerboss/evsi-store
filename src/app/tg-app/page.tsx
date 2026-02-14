// file: src/app/tg-app/page.tsx

'use client';

import { useEffect, useState } from 'react';

// Типы данных для каналов
type Channel = {
  id: string;
  name: string;
  category: string;
  priceStars: number;
  username: string;
};

// Интерфейс для пользователя Telegram (вместо any)
interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_bot?: boolean;
}

// Данные, приходящие от Telegram WebApp
interface TelegramWebAppInitData {
  user?: TelegramUser;
  start_param?: string;
  auth_date?: number;
  hash?: string;
  // ... другие поля при необходимости
}

interface FormData {
  title: string;
  description: string;
  contacts: string;
  salary: string;
  company?: string;
  location?: string;
  experience?: string;
  skills?: string;
  [key: string]: string | undefined;
}

// Интерфейс для отправки на сервер
interface JobPayloadRequest {
  title: string;
  description: string;
  contacts: string;
  salary: string;
  company?: string;
  location?: string;
  experience?: string;
  skills?: string;
}

export default function TgAppPage() {
  const [activeTab, setActiveTab] = useState<'VACANCY' | 'RESUME'>('VACANCY');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ИСПРАВЛЕНО: Строгая типизация вместо any
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  
  // Состояние формы
  const [formData, setFormData] = useState<FormData>({
    title: '', description: '', contacts: '', salary: '',
    company: '', location: '', experience: '', skills: ''
  });

  // Инициализация
  useEffect(() => {
    // 1. Загрузка каналов
    const fetchChannels = async () => {
      try {
        const res = await fetch('/api/tg-jobs');
        const data: Channel[] = await res.json();
        setChannels(data);
        return data;
      } catch (e) {
        console.error(e);
        return [];
      }
    };

    // 2. Инициализация Telegram
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      
      // Безопасное приведение типов
      const initData = tg.initDataUnsafe as TelegramWebAppInitData;
      if (initData?.user) {
        setTgUser(initData.user);
      }

      // Работа со start_param
      const startParam = initData?.start_param;
      
      fetchChannels().then((loadedChannels) => {
        setLoading(false);
        if (startParam) {
           const targetChannel = loadedChannels.find(c => c.id === startParam || c.username.replace('@', '') === startParam);
           if (targetChannel) {
             setSelectedIds([targetChannel.id]);
           }
        }
      });

      document.body.style.backgroundColor = tg.themeParams.bg_color || '#fff';
      document.body.style.color = tg.themeParams.text_color || '#000';
    } else {
        fetchChannels().then(() => setLoading(false));
    }
  }, []);

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleChannel = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const totalPrice = channels
    .filter((c) => selectedIds.includes(c.id))
    .reduce((sum: number, ch: Channel) => sum + ch.priceStars, 0);

  const handlePay = async () => {
    if (!formData.title || !formData.description || !formData.contacts) {
        window.Telegram?.WebApp?.showAlert('Заполните обязательные поля: Заголовок, Описание, Контакты');
        return;
    }
    if (selectedIds.length === 0) {
        window.Telegram?.WebApp?.showAlert('Выберите хотя бы один канал');
        return;
    }

    // Подготовка типизированного объекта
    const payloadToSend: JobPayloadRequest = {
      title: formData.title,
      description: formData.description,
      contacts: formData.contacts,
      salary: formData.salary,
      company: activeTab === 'VACANCY' ? formData.company : undefined,
      location: activeTab === 'VACANCY' ? formData.location : undefined,
      experience: activeTab === 'RESUME' ? formData.experience : undefined,
      skills: activeTab === 'RESUME' ? formData.skills : undefined,
    };

    try {
      const res = await fetch('/api/tg-jobs', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_invoice',
          channelIds: selectedIds,
          type: activeTab,
          payload: payloadToSend,
          userId: tgUser?.id || '12345',
          username: tgUser?.username
        }),
      });
      
      const data = await res.json();
      if (data.invoiceLink) {
        window.Telegram.WebApp.openInvoice(data.invoiceLink, (status: string) => {
            if (status === 'paid') window.Telegram.WebApp.close();
        });
      }
    } catch (e) {
      alert('Ошибка соединения');
    }
  };

  const renderInput = (label: string, field: keyof FormData, placeholder: string, multiline = false) => (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{label}</label>
      {multiline ? (
        <textarea
          className="w-full p-3 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm min-h-[100px]"
          placeholder={placeholder}
          value={formData[field] || ''}
          onChange={e => handleInputChange(field, e.target.value)}
        />
      ) : (
        <input
          type="text"
          className="w-full p-3 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm"
          placeholder={placeholder}
          value={formData[field] || ''}
          onChange={e => handleInputChange(field, e.target.value)}
        />
      )}
    </div>
  );

  if (loading) return <div className="flex justify-center items-center h-screen">Загрузка...</div>;

  return (
    <div className="pb-24 bg-gray-50 min-h-screen">
      <div className="flex bg-white border-b sticky top-0 z-10">
        <button 
          onClick={() => setActiveTab('VACANCY')}
          className={`flex-1 py-4 text-sm font-bold text-center border-b-2 transition ${activeTab === 'VACANCY' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
        >
          💼 Вакансия
        </button>
        <button 
          onClick={() => setActiveTab('RESUME')}
          className={`flex-1 py-4 text-sm font-bold text-center border-b-2 transition ${activeTab === 'RESUME' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
        >
          👤 Резюме
        </button>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <div className="bg-white p-4 rounded-xl shadow-sm mb-6">
            {renderInput(activeTab === 'VACANCY' ? 'Должность' : 'Желаемая должность', 'title', 'Например: Senior Frontend Developer')}
            
            {activeTab === 'VACANCY' && renderInput('Компания', 'company', 'Название компании')}
            {activeTab === 'VACANCY' && renderInput('Зарплата', 'salary', 'Например: от 200 000 руб')}
            {activeTab === 'VACANCY' && renderInput('Локация / Формат', 'location', 'Москва, Удаленно, Офис')}
            
            {activeTab === 'RESUME' && renderInput('Зарплатные ожидания', 'salary', 'Например: 150 000 руб')}
            {activeTab === 'RESUME' && renderInput('Опыт работы', 'experience', 'Например: 5 лет в финтехе')}
            {activeTab === 'RESUME' && renderInput('Ключевые навыки', 'skills', 'React, Next.js, TypeScript...')}

            {renderInput('Описание', 'description', 'Подробное описание...', true)}
            {renderInput('Контакты для связи', 'contacts', '@username или email')}
        </div>

        <h3 className="text-sm font-bold text-gray-900 mb-3 px-1">Где опубликовать?</h3>
        <div className="space-y-2 mb-6">
            {channels.map((ch: Channel) => (
                <div 
                    key={ch.id} 
                    onClick={() => toggleChannel(ch.id)}
                    className={`flex justify-between items-center p-3 rounded-xl border cursor-pointer transition ${selectedIds.includes(ch.id) ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-gray-200'}`}
                >
                    <div>
                        <div className="text-sm font-medium">{ch.name}</div>
                        <div className="text-xs text-gray-400">{ch.username}</div>
                    </div>
                    <div className="text-xs font-bold bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                        ⭐️ {ch.priceStars}
                    </div>
                </div>
            ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t safe-area-bottom">
        <button
          onClick={handlePay}
          disabled={totalPrice === 0}
          className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
        >
          {totalPrice === 0 ? 'Выберите каналы' : `Оплатить ⭐️ ${totalPrice}`}
        </button>
      </div>
    </div>
  );
}