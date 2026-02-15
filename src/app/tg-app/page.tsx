// file: src/app/tg-app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { formatOrderText } from '@/lib/telegram'; // Используем функцию форматирования для превью

// SVG Icons (чтобы не зависеть от библиотек)
const ChevronLeft = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>;
const CheckCircle = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const Briefcase = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const UserCircle = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></svg>;

// Типы
type Channel = {
  id: string;
  name: string;
  category: string;
  priceStars: number;
  username: string;
};

// Интерфейс пользователя Telegram
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
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

// Лимиты символов
const MAX_TOTAL_CHARS = 3500; // Оставляем запас под хештеги
const CHAR_LIMITS: Record<string, number> = {
    title: 100,
    company: 100,
    salary: 50,
    location: 100,
    experience: 200,
    skills: 300,
    description: 2500,
    contacts: 150
};

export default function TgAppPage() {
  const [step, setStep] = useState(1);
  const [activeTab, setActiveTab] = useState<'VACANCY' | 'RESUME'>('VACANCY');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Исправлено: типизация пользователя
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  
  const [formData, setFormData] = useState<FormData>({
    title: '', description: '', contacts: '', salary: '',
    company: '', location: '', experience: '', skills: ''
  });

  // Загрузка
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/tg-jobs');
        const data = await res.json();
        setChannels(data);

        if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
          const tg = window.Telegram.WebApp;
          tg.ready();
          tg.expand();
          // Приведение типа, так как initDataUnsafe может быть любым
          setTgUser(tg.initDataUnsafe?.user as TelegramUser);
          
          // Темизация
          document.body.style.backgroundColor = tg.themeParams.secondary_bg_color || '#f5f5f5';
          document.body.style.color = tg.themeParams.text_color || '#000000';

          const startParam = tg.initDataUnsafe?.start_param;
          if (startParam && Array.isArray(data)) {
             const target = data.find((c: Channel) => c.id === startParam || c.username.replace('@', '') === startParam);
             if (target) setSelectedIds([target.id]);
          }
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    init();
  }, []);

  // Навигация
  const goNext = () => {
      if (step === 2 && !validateForm()) return;
      if (step === 3 && selectedIds.length === 0) {
          window.Telegram?.WebApp?.showAlert('Выберите хотя бы один канал');
          return;
      }
      setStep(prev => prev + 1);
      window.scrollTo(0,0);
  };
  
  const goBack = () => {
      setStep(prev => prev - 1);
      window.scrollTo(0,0);
  };

  const getLabel = (field: string) => {
    const labels: Record<string, string> = {
        title: activeTab === 'VACANCY' ? 'Должность' : 'Желаемая должность',
        company: 'Компания',
        salary: activeTab === 'VACANCY' ? 'Зарплата' : 'Зарплатные ожидания',
        location: 'Локация / Формат',
        experience: 'Опыт работы',
        skills: 'Ключевые навыки',
        description: 'Описание',
        contacts: 'Контакты'
    };
    return labels[field] || field;
};

  // Валидация
  const validateForm = () => {
      const required = ['title', 'description', 'contacts'];
      for (const field of required) {
          // Приводим field к keyof FormData для доступа, но getLabel ожидает string
          if (!formData[field as keyof FormData]?.trim()) {
              window.Telegram?.WebApp?.showAlert(`Поле "${getLabel(field)}" обязательно для заполнения`);
              return false;
          }
      }

      // Валидация контактов
      const contactRegex = /(@[\w\d_]+|https?:\/\/[^\s]+|[\w\d._%+-]+@[\w\d.-]+\.[\w]{2,4})/i;
      if (!contactRegex.test(formData.contacts)) {
          window.Telegram?.WebApp?.showAlert('В контактах укажите @username, ссылку на сайт или email');
          return false;
      }

      // Проверка длины
      const totalLen = Object.values(formData).reduce((acc, val) => acc + (val?.length || 0), 0);
      if (totalLen > MAX_TOTAL_CHARS) {
           window.Telegram?.WebApp?.showAlert(`Слишком длинный текст (${totalLen}/${MAX_TOTAL_CHARS}). Сократите описание.`);
           return false;
      }

      return true;
  };

  const totalPrice = channels
    .filter((c) => selectedIds.includes(c.id))
    .reduce((sum, c) => sum + c.priceStars, 0);

  const handlePay = async () => {
    try {
      const res = await fetch('/api/tg-jobs', {
        method: 'POST',
        body: JSON.stringify({
            action: 'create_invoice',
            channelIds: selectedIds,
            type: activeTab,
            payload: formData,
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
      alert('Ошибка создания заказа');
    }
  };

  // Компоненты шагов
  const Step1TypeSelection = () => (
      <div className="flex flex-col gap-4 mt-8">
          <button 
              onClick={() => { setActiveTab('VACANCY'); goNext(); }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-transparent hover:border-blue-500 transition active:scale-95 flex items-center gap-4"
          >
              <div className="bg-blue-100 p-4 rounded-full text-blue-600">
                  <Briefcase />
              </div>
              <div className="text-left">
                  <h3 className="text-lg font-bold text-gray-900">Ищу сотрудника</h3>
                  <p className="text-sm text-gray-500">Опубликовать вакансию в каналы</p>
              </div>
          </button>

          <button 
              onClick={() => { setActiveTab('RESUME'); goNext(); }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-transparent hover:border-purple-500 transition active:scale-95 flex items-center gap-4"
          >
              <div className="bg-purple-100 p-4 rounded-full text-purple-600">
                  <UserCircle />
              </div>
              <div className="text-left">
                  <h3 className="text-lg font-bold text-gray-900">Ищу работу</h3>
                  <p className="text-sm text-gray-500">Разместить резюме</p>
              </div>
          </button>
      </div>
  );

  const Step2Form = () => {
    const renderInput = (field: keyof FormData, placeholder: string, multiline = false) => {
        // Приводим field к string, так как ключи CHAR_LIMITS это строки
        const fieldName = field as string; 
        const currentLength = formData[field]?.length || 0;
        const limit = CHAR_LIMITS[fieldName] || 0;
        const isOverLimit = currentLength > limit;

        return (
            <div className="mb-4 relative">
            <div className="flex justify-between mb-1">
                {/* Исправлено: приведение типа field к string для getLabel */}
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{getLabel(fieldName)}</label>
                {/* Исправлено: Безопасная проверка длины без '!' */}
                <span className={`text-xs ${isOverLimit ? 'text-red-500' : 'text-gray-300'}`}>
                    {currentLength}/{limit}
                </span>
            </div>
            
            {multiline ? (
                <textarea
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm min-h-[140px] resize-none"
                placeholder={placeholder}
                value={formData[field] || ''}
                onChange={e => {
                    if (e.target.value.length <= limit) {
                        setFormData({...formData, [field]: e.target.value});
                    }
                }}
                />
            ) : (
                <input
                type="text"
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                placeholder={placeholder}
                value={formData[field] || ''}
                onChange={e => {
                    if (e.target.value.length <= limit) {
                        setFormData({...formData, [field]: e.target.value});
                    }
                }}
                />
            )}
            </div>
        );
    };

      return (
          <div className="bg-white p-5 rounded-2xl shadow-sm space-y-2 pb-8">
              {renderInput('title', 'Например: Senior React Developer')}
              
              {activeTab === 'VACANCY' && (
                  <div className="grid grid-cols-2 gap-3">
                      {renderInput('company', 'Google')}
                      {renderInput('location', 'Москва, Офис')}
                  </div>
              )}
              {renderInput('salary', 'от 200 000 руб')}
              
              {activeTab === 'RESUME' && renderInput('experience', '5 лет, Яндекс...')}
              {activeTab === 'RESUME' && renderInput('skills', 'JS, TS, React, Node.js')}

              {renderInput('description', 'Подробное описание задач и требований...', true)}
              {renderInput('contacts', '@username, email@ya.ru или ссылка')}
          </div>
      );
  };

  const Step3Channels = () => {
      // Группировка
      const grouped = channels.reduce((acc, ch) => {
          if (!acc[ch.category]) acc[ch.category] = [];
          acc[ch.category].push(ch);
          return acc;
      }, {} as Record<string, Channel[]>);

      return (
          <div className="space-y-6 pb-20">
              {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                      <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">{cat}</h3>
                      <div className="bg-white rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
                          {list.map(ch => {
                              const isSelected = selectedIds.includes(ch.id);
                              return (
                                  <div 
                                    key={ch.id}
                                    onClick={() => {
                                        setSelectedIds(prev => 
                                            prev.includes(ch.id) ? prev.filter(i => i !== ch.id) : [...prev, ch.id]
                                        );
                                    }}
                                    className={`p-4 flex items-center justify-between cursor-pointer transition active:bg-gray-50 ${isSelected ? 'bg-blue-50/50' : ''}`}
                                  >
                                      <div className="flex items-center gap-3">
                                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                                              {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                          </div>
                                          <div>
                                              <div className="text-sm font-medium text-gray-900">{ch.name}</div>
                                              <div className="text-xs text-gray-400">{ch.username}</div>
                                          </div>
                                      </div>
                                      <div className="text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
                                          ⭐️ {ch.priceStars}
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              ))}
          </div>
      );
  };

  const Step4Preview = () => {
      // Используем ту же функцию форматирования, что и на сервере, но для рендера
      // Для простоты здесь сэмулируем HTML вид
      const rawText = formatOrderText(activeTab, formData);
      const htmlContent = rawText.replace(/\n/g, '<br/>');

      return (
          <div className="space-y-6">
              <div className="bg-white p-4 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl shadow-sm max-w-[90%] relative">
                  <div className="text-xs text-blue-500 font-bold mb-1">Предпросмотр</div>
                  <div 
                    className="text-sm text-gray-900 leading-relaxed break-words"
                    dangerouslySetInnerHTML={{ __html: htmlContent }} 
                  />
                  <div className="text-[10px] text-gray-400 text-right mt-2">14:02</div>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800">
                  <p className="font-bold mb-1">ℹ️ Информация:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs opacity-90">
                      <li>Модерация занимает до 24 часов</li>
                      <li>Публикация: 9:00 - 20:00 МСК</li>
                      <li>После публикации бот пришлет ссылки</li>
                  </ul>
              </div>
          </div>
      );
  };

  // Main Render
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Загрузка...</div>;

  return (
    <div className="min-h-screen font-sans bg-[#f3f4f6] text-gray-900 pb-24">
        {/* Header */}
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between">
            {step > 1 ? (
                <button onClick={goBack} className="p-1 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full">
                    <ChevronLeft />
                </button>
            ) : <div className="w-8" />}
            
            <div className="font-semibold text-sm">
                Шаг {step} из 4
            </div>
            <div className="w-8" /> 
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-200 w-full">
            <div 
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${(step / 4) * 100}%` }}
            />
        </div>

        {/* Content */}
        <div className="p-4 max-w-lg mx-auto">
            {step === 1 && (
                <div className="text-center mt-4">
                    <h1 className="text-2xl font-bold mb-2">Что публикуем?</h1>
                    <p className="text-gray-500 text-sm">Выберите тип объявления</p>
                    <Step1TypeSelection />
                </div>
            )}
            
            {step === 2 && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">Заполните данные</h2>
                    <Step2Form />
                </>
            )}

            {step === 3 && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">Выберите каналы</h2>
                    <Step3Channels />
                </>
            )}

            {step === 4 && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">Проверка</h2>
                    <Step4Preview />
                </>
            )}
        </div>

        {/* Footer Actions */}
        {step > 1 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 safe-area-bottom z-30 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
                <div className="max-w-lg mx-auto flex items-center gap-4">
                    {step === 3 && (
                        <div className="flex-1">
                            <div className="text-xs text-gray-400">Итого:</div>
                            <div className="text-lg font-bold text-gray-900">⭐️ {totalPrice}</div>
                        </div>
                    )}
                    
                    <button
                        onClick={step === 4 ? handlePay : goNext}
                        disabled={step === 3 && totalPrice === 0}
                        className={`
                            bg-blue-600 text-white font-bold py-3 px-6 rounded-xl transition active:scale-95 shadow-lg shadow-blue-200
                            ${step === 3 ? 'w-auto px-8' : 'w-full'}
                            disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                    >
                        {step === 4 ? `Оплатить ⭐️ ${totalPrice}` : 'Далее'}
                    </button>
                </div>
            </div>
        )}
    </div>
  );
}