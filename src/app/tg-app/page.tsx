// file: src/app/tg-app/page.tsx
'use client';

import { useEffect, useState, Dispatch, SetStateAction } from 'react';

// --- SVG Icons ---
const ChevronLeft = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>;
const CheckCircle = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const Briefcase = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const UserCircle = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/></svg>;
const Coffee = () => <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>;

// --- Types ---
type Channel = {
  id: string;
  name: string;
  category: string;
  priceStars: number;
  username: string;
};

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
  rcName?: string;
  rcSpecialty?: string;
  rcInterests?: string;
  rcLinkedin?: string;
  [key: string]: string | undefined;
}

// --- Constants ---
const MAX_TOTAL_CHARS = 3800; 
const CHAR_LIMITS: Record<string, number> = {
    title: 150,
    company: 150,
    salary: 100,
    location: 150,
    experience: 500,
    skills: 500,
    description: 3000,
    contacts: 200,
    rcName: 100,
    rcSpecialty: 100,
    rcInterests: 500,
    rcLinkedin: 200
};

// --- Helpers ---
function sanitize(str: string | undefined) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatOrderText(type: 'VACANCY' | 'RESUME' | 'RANDOM_COFFEE', payload: FormData): string {
  if (type === 'VACANCY') {
    return `
<b>💼 ВАКАНСИЯ: ${sanitize(payload.title)}</b>

<b>Компания:</b> ${sanitize(payload.company)}
<b>Зарплата:</b> ${sanitize(payload.salary || 'Не указана')}
<b>Локация/Format:</b> ${sanitize(payload.location)}

${sanitize(payload.description)}

<b>Контакты:</b> ${sanitize(payload.contacts)}

#вакансия
    `.trim();
  } else if (type === 'RESUME') {
    return `
<b>👤 РЕЗЮМЕ: ${sanitize(payload.title)}</b>

<b>Опыт:</b> ${sanitize(payload.experience)}
<b>Зарплата:</b> ${sanitize(payload.salary || 'По договоренности')}
<b>Навыки:</b> ${sanitize(payload.skills)}

${sanitize(payload.description)}

<b>Контакты:</b> ${sanitize(payload.contacts)}

#резюме
    `.trim();
  } else {
      return `
<b>☕️ Random Coffee: ${sanitize(payload.rcName)}</b>

<b>Специальность:</b> ${sanitize(payload.rcSpecialty)}
<b>Интересы:</b> ${sanitize(payload.rcInterests)}
${payload.rcLinkedin ? `<b>LinkedIn:</b> ${sanitize(payload.rcLinkedin)}` : ''}

<i>Ваша анкета готова к участию в пятничном нетворкинге!</i>
      `.trim();
  }
}

const getLabel = (field: string, activeTab: string) => {
    const labels: Record<string, string> = {
        title: activeTab === 'VACANCY' ? 'Должность' : 'Желаемая должность',
        company: 'Компания',
        salary: activeTab === 'VACANCY' ? 'Зарплата' : 'Зарплатные ожидания',
        location: 'Локация / Формат',
        experience: 'Опыт работы',
        skills: 'Ключевые навыки',
        description: 'Описание',
        contacts: 'Контакты',
        rcName: 'Ваше Имя',
        rcSpecialty: 'Специальность',
        rcInterests: 'Профессиональные интересы',
        rcLinkedin: 'Ссылка на LinkedIn (опционально)'
    };
    return labels[field] || field;
};

// --- Sub-Components ---

const Step1TypeSelection = ({ setActiveTab, goNext }: { setActiveTab: (t: 'VACANCY' | 'RESUME' | 'RANDOM_COFFEE') => void, goNext: () => void }) => (
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

        <button 
            onClick={() => { setActiveTab('RANDOM_COFFEE'); goNext(); }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-transparent hover:border-orange-500 transition active:scale-95 flex items-center gap-4 relative overflow-hidden"
        >
            <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold">NEW</div>
            <div className="bg-orange-100 p-4 rounded-full text-orange-600">
                <Coffee />
            </div>
            <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">Случайный кофе</h3>
                <p className="text-sm text-gray-500">Нетворкинг по пятницам (100 ⭐️)</p>
            </div>
        </button>
    </div>
);

const Step2Form = ({ formData, setFormData, activeTab }: { formData: FormData, setFormData: Dispatch<SetStateAction<FormData>>, activeTab: string }) => {
    const renderInput = (field: keyof FormData, placeholder: string, multiline = false) => {
        const fieldName = field as string; 
        const currentLength = formData[field]?.length || 0;
        const limit = CHAR_LIMITS[fieldName] || 0;
        const isOverLimit = currentLength > limit;

        return (
            <div className="mb-4 relative">
            <div className="flex justify-between mb-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{getLabel(fieldName, activeTab)}</label>
                <span className={`text-xs ${isOverLimit ? 'text-red-500' : 'text-gray-300'}`}>
                    {currentLength}/{limit}
                </span>
            </div>
            
            {multiline ? (
                <textarea
                className={`w-full p-3 bg-white border rounded-xl outline-none text-sm min-h-[140px] resize-none text-black transition-colors ${isOverLimit ? 'border-red-500 focus:border-red-500 bg-red-50' : 'border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent'}`}
                placeholder={placeholder}
                value={formData[field] || ''}
                onChange={e => {
                    setFormData(prev => ({...prev, [field]: e.target.value}));
                }}
                />
            ) : (
                <input
                type="text"
                className={`w-full p-3 bg-white border rounded-xl outline-none text-sm text-black transition-colors ${isOverLimit ? 'border-red-500 focus:border-red-500 bg-red-50' : 'border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent'}`}
                placeholder={placeholder}
                value={formData[field] || ''}
                onChange={e => {
                    setFormData(prev => ({...prev, [field]: e.target.value}));
                }}
                />
            )}
            </div>
        );
    };

      return (
          <div className="bg-white p-5 rounded-2xl shadow-sm space-y-2 pb-8">
              {activeTab === 'VACANCY' && (
                  <>
                    {renderInput('title', 'Например: Senior React Developer')}
                    <div className="grid grid-cols-2 gap-3">
                        {renderInput('company', 'Google')}
                        {renderInput('location', 'Москва, Офис')}
                    </div>
                    {renderInput('salary', 'от 200 000 руб')}
                    {renderInput('description', 'Подробное описание задач и требований...', true)}
                    {renderInput('contacts', '@username, email@ya.ru или ссылка')}
                  </>
              )}
              
              {activeTab === 'RESUME' && (
                  <>
                    {renderInput('title', 'Например: Senior React Developer')}
                    {renderInput('salary', 'от 200 000 руб')}
                    {renderInput('experience', '5 лет, Яндекс...')}
                    {renderInput('skills', 'JS, TS, React, Node.js')}
                    {renderInput('description', 'О себе...', true)}
                    {renderInput('contacts', '@username, email@ya.ru или ссылка')}
                  </>
              )}

              {activeTab === 'RANDOM_COFFEE' && (
                  <>
                    <p className="text-xs text-gray-500 mb-4 bg-orange-50 p-3 rounded-lg border border-orange-100">
                        Эти данные будут сохранены и показаны вашему собеседнику в случае совпадения.
                    </p>
                    {renderInput('rcName', 'Иван Иванов')}
                    {renderInput('rcSpecialty', 'Product Manager, Python Dev...')}
                    {renderInput('rcInterests', 'О чем хотите поговорить? AI, стартапы, рыбалка...', true)}
                    {renderInput('rcLinkedin', 'https://linkedin.com/in/...')}
                  </>
              )}
          </div>
      );
};

const Step3Channels = ({ channels, selectedIds, setSelectedIds }: { channels: Channel[], selectedIds: string[], setSelectedIds: Dispatch<SetStateAction<string[]>> }) => {
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

const Step4Preview = ({ activeTab, formData, isParticipating }: { activeTab: 'VACANCY' | 'RESUME' | 'RANDOM_COFFEE', formData: FormData, isParticipating: boolean }) => {
    const rawText = formatOrderText(activeTab, formData);
    const htmlContent = rawText.replace(/\n/g, '<br/>');

    if (activeTab === 'RANDOM_COFFEE') {
        return (
            <div className="space-y-6">
                {isParticipating && (
                    <div className="bg-green-100 border border-green-200 text-green-800 p-4 rounded-xl text-sm font-bold flex items-center gap-2">
                        <CheckCircle /> Вы уже участвуете в эту пятницу!
                    </div>
                )}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-100 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-yellow-400"></div>
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <span className="text-2xl">☕️</span> Карточка участника
                    </h3>
                    <div className="space-y-3 text-sm">
                        <div>
                            <span className="text-gray-400 text-xs uppercase font-bold">Имя</span>
                            <div className="text-gray-900 font-medium">{formData.rcName}</div>
                        </div>
                        <div>
                            <span className="text-gray-400 text-xs uppercase font-bold">Специальность</span>
                            <div className="text-gray-900">{formData.rcSpecialty}</div>
                        </div>
                        <div>
                            <span className="text-gray-400 text-xs uppercase font-bold">Интересы</span>
                            <div className="text-gray-900">{formData.rcInterests}</div>
                        </div>
                        {formData.rcLinkedin && (
                            <div>
                                <span className="text-gray-400 text-xs uppercase font-bold">LinkedIn</span>
                                <div className="text-blue-500 truncate">{formData.rcLinkedin}</div>
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 text-sm text-orange-800">
                    <p className="font-bold mb-1">ℹ️ Как это работает:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs opacity-90">
                        <li>Распределение: Ближайшая пятница 10:00 МСК</li>
                        <li>Мы подберем вам пару по интересам</li>
                        <li>Если пары не будет — вернем 100 звезд</li>
                        <li>Бот пришлет контакт собеседника в ЛС</li>
                    </ul>
                </div>
            </div>
        );
    }

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


// --- Main Component ---

export default function TgAppPage() {
  const [step, setStep] = useState(1);
  const [activeTab, setActiveTab] = useState<'VACANCY' | 'RESUME' | 'RANDOM_COFFEE'>('VACANCY');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  
  const [formData, setFormData] = useState<FormData>({
    title: '', description: '', contacts: '', salary: '',
    company: '', location: '', experience: '', skills: '',
    rcName: '', rcSpecialty: '', rcInterests: '', rcLinkedin: ''
  });
  
  // Добавляем стейт участия
  const [isParticipating, setIsParticipating] = useState(false);

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
          setTgUser(tg.initDataUnsafe?.user as TelegramUser);
          
          document.body.style.backgroundColor = tg.themeParams.secondary_bg_color || '#f3f4f6';
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

  // Загрузка профиля при выборе Random Coffee
  useEffect(() => {
      if (activeTab === 'RANDOM_COFFEE' && tgUser?.id) {
          fetch(`/api/tg-jobs?action=get_profile&userId=${tgUser.id}`)
            .then(res => res.json())
            .then(data => {
                if (data) {
                    setIsParticipating(data.isParticipating);
                    if (data.profile) {
                        setFormData(prev => ({
                            ...prev,
                            rcName: data.profile.name || '',
                            rcSpecialty: data.profile.specialty || '',
                            rcInterests: data.profile.interests || '',
                            rcLinkedin: data.profile.linkedin || ''
                        }));
                    }
                }
            })
            .catch(e => console.error("Profile load error", e));
      }
  }, [activeTab, tgUser]);

  // Валидация
  const validateForm = () => {
      let required: string[] = [];
      
      if (activeTab === 'VACANCY' || activeTab === 'RESUME') {
          required = ['title', 'description', 'contacts'];
      } else if (activeTab === 'RANDOM_COFFEE') {
          required = ['rcName', 'rcSpecialty', 'rcInterests'];
      }

      for (const field of required) {
          if (!formData[field as keyof FormData]?.trim()) {
              window.Telegram?.WebApp?.showAlert(`Поле "${getLabel(field, activeTab)}" обязательно для заполнения`);
              return false;
          }
      }

      // Доп проверки для вакансий/резюме
      if (activeTab !== 'RANDOM_COFFEE') {
          const contactRegex = /(@[\w\d_]+|https?:\/\/[^\s]+|[\w\d._%+-]+@[\w\d.-]+\.[\w]{2,4})/i;
          if (!contactRegex.test(formData.contacts)) {
              window.Telegram?.WebApp?.showAlert('В контактах укажите @username, ссылку на сайт или email');
              return false;
          }
      }

      // Общая длина
      const totalLen = Object.values(formData).reduce((acc, val) => acc + (val?.length || 0), 0);
      if (totalLen > MAX_TOTAL_CHARS) {
           window.Telegram?.WebApp?.showAlert(`Общий размер текста слишком большой (${totalLen}/${MAX_TOTAL_CHARS}). Сократите описание.`);
           return false;
      }

      return true;
  };

  // Навигация
  const goNext = () => {
      if (step === 2 && !validateForm()) return;
      if (step === 3 && activeTab !== 'RANDOM_COFFEE' && selectedIds.length === 0) {
          window.Telegram?.WebApp?.showAlert('Выберите хотя бы один канал');
          return;
      }
      // Для Random Coffee пропускаем шаг 3 (выбор каналов)
      if (step === 2 && activeTab === 'RANDOM_COFFEE') {
          setStep(4);
      } else {
          setStep(prev => prev + 1);
      }
      window.scrollTo(0,0);
  };
  
  const goBack = () => {
      if (step === 4 && activeTab === 'RANDOM_COFFEE') {
          setStep(2);
      } else {
          setStep(prev => prev - 1);
      }
      window.scrollTo(0,0);
  };

  const totalPrice = activeTab === 'RANDOM_COFFEE' 
    ? 100 
    : channels.filter((c) => selectedIds.includes(c.id)).reduce((sum, c) => sum + c.priceStars, 0);

  const handlePay = async () => {
    try {
      const res = await fetch('/api/tg-jobs', {
        method: 'POST',
        body: JSON.stringify({
            action: 'create_invoice',
            channelIds: activeTab === 'RANDOM_COFFEE' ? [] : selectedIds,
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
    } catch {
      alert('Ошибка создания заказа');
    }
  };

  // Обработка отмены
  const handleCancel = async () => {
      window.Telegram?.WebApp?.showConfirm('Вы уверены, что хотите отменить участие? Мы вернем вам 100 звезд.', async (confirmed: boolean) => {
          if (confirmed) {
              try {
                  const res = await fetch('/api/tg-jobs', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'cancel_random_coffee', userId: tgUser?.id || '12345' }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                      setIsParticipating(false);
                      window.Telegram?.WebApp?.showAlert('Участие отменено, средства возвращены.');
                  } else {
                      alert('Ошибка отмены: ' + (data.error || 'Unknown'));
                  }
              } catch { alert('Ошибка соединения'); }
          }
      });
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
                Шаг {step === 4 && activeTab === 'RANDOM_COFFEE' ? '3' : step} из {activeTab === 'RANDOM_COFFEE' ? '3' : '4'}
            </div>
            <div className="w-8" /> 
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-200 w-full">
            <div 
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${(step / (activeTab === 'RANDOM_COFFEE' ? 4 : 4)) * 100}%` }}
            />
        </div>

        {/* Content */}
        <div className="p-4 max-w-lg mx-auto">
            {step === 1 && (
                <div className="text-center mt-4">
                    <h1 className="text-2xl font-bold mb-2">Что запускаем?</h1>
                    <p className="text-gray-500 text-sm">Выберите сервис</p>
                    <Step1TypeSelection setActiveTab={setActiveTab} goNext={goNext} />
                </div>
            )}
            
            {step === 2 && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">
                        {activeTab === 'RANDOM_COFFEE' ? 'Ваш профиль' : 'Заполните данные'}
                    </h2>
                    <Step2Form formData={formData} setFormData={setFormData} activeTab={activeTab} />
                </>
            )}

            {step === 3 && activeTab !== 'RANDOM_COFFEE' && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">Выберите каналы</h2>
                    <Step3Channels channels={channels} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />
                </>
            )}

            {step === 4 && (
                <>
                    <h2 className="text-xl font-bold mb-4 px-1">
                        {activeTab === 'RANDOM_COFFEE' ? 'Подтверждение' : 'Проверка'}
                    </h2>
                    <Step4Preview activeTab={activeTab} formData={formData} isParticipating={isParticipating} />
                </>
            )}
        </div>

        {/* Footer Actions */}
        {step > 1 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 safe-area-bottom z-30 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
                <div className="max-w-lg mx-auto flex items-center gap-4">
                    {(step === 3 || (activeTab === 'RANDOM_COFFEE' && step === 4)) && (
                        <div className="flex-1">
                            <div className="text-xs text-gray-400">Итого:</div>
                            <div className="text-lg font-bold text-gray-900">⭐️ {totalPrice}</div>
                        </div>
                    )}
                    
                    {step === 4 && activeTab === 'RANDOM_COFFEE' && isParticipating ? (
                        <button onClick={handleCancel} className="w-full bg-red-50 text-red-600 border border-red-200 font-bold py-3 px-6 rounded-xl transition active:scale-95 shadow-lg">Отменить участие и вернуть 100 ⭐️</button>
                    ) : (
                        <button onClick={step === 4 ? handlePay : goNext} disabled={step === 3 && activeTab !== 'RANDOM_COFFEE' && totalPrice === 0} className={`bg-blue-600 text-white font-bold py-3 px-6 rounded-xl transition active:scale-95 shadow-lg shadow-blue-200 ${(step === 3 || step === 4) ? 'w-auto px-8' : 'w-full'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                            {step === 4 ? (activeTab === 'RANDOM_COFFEE' ? `Участвовать (⭐️ ${totalPrice})` : `Оплатить ⭐️ ${totalPrice}`) : 'Далее'}
                        </button>
                    )}
                </div>
            </div>
        )}
    </div>
  );
}