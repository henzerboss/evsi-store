// file: src/app/tg-app/page.tsx
"use client";

import { useEffect, useMemo, useState, Dispatch, SetStateAction } from "react";

// --- SVG Icons ---
const ChevronLeft = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const CheckCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const Briefcase = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);
const UserCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="10" r="3" />
    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
  </svg>
);
const Coffee = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
    <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
    <line x1="6" x2="6" y1="2" y2="4" />
    <line x1="10" x2="10" y1="2" y2="4" />
    <line x1="14" x2="14" y1="2" y2="4" />
  </svg>
);
const MagicWand = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m19 2 2 2-2 2-2-2 2-2Z" />
    <path d="m5 6 4 4-4 4-4-4 4-4Z" />
    <path d="m15 13 4 4-4 4-4-4 4-4Z" />
  </svg>
);

// --- Types ---
type AppTab = "VACANCY" | "RESUME" | "RANDOM_COFFEE";
type ResumeMode = "ORIGINAL" | "CORRECTED";

type Channel = { id: string; name: string; category: string; priceStars: number; username: string };

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface VacancyForm {
  title: string;
  company: string;
  salary: string;
  location: string;
  description: string;
  contacts: string;
}
interface ResumeForm {
  title: string;
  salary: string;
  experience: string;
  skills: string;
  description: string;
  contacts: string;
}
interface RCForm {
  rcName: string;
  rcSpecialty: string;
  rcInterests: string;
  rcLinkedin: string;
}

type AnyFormData = VacancyForm | ResumeForm | RCForm;
type FormUpdater = (prev: AnyFormData) => AnyFormData;

interface AIChange {
  field: string;
  what_fixed: string;
  why: string;
}

type TgSettings = {
  vacancyBasePriceStars: number;
  resumeBasePriceStars: number;
  channelDiscountPercent: number;
};

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
  rcLinkedin: 200,
};

// --- Helpers ---
function sanitize(str: string | undefined) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function calcDiscounted(price: number, discountPercent: number) {
  const p = clampInt(price, 0, 1_000_000);
  const d = clampInt(discountPercent, 0, 95);
  const v = Math.round((p * (100 - d)) / 100);
  return Math.max(1, v);
}

function formatOrderText(type: AppTab, payload: AnyFormData): string {
  if (type === "VACANCY") {
    const d = payload as VacancyForm;
    return `<b>💼 ВАКАНСИЯ: ${sanitize(d.title)}</b>\n\n<b>Компания:</b> ${sanitize(d.company)}\n<b>Зарплата:</b> ${sanitize(
      d.salary || "Не указана"
    )}\n<b>Локация/Format:</b> ${sanitize(d.location)}\n\n${sanitize(d.description)}\n\n<b>Контакты:</b> ${sanitize(
      d.contacts
    )}\n\n#вакансия`;
  } else if (type === "RESUME") {
    const d = payload as ResumeForm;
    return `<b>👤 РЕЗЮМЕ: ${sanitize(d.title)}</b>\n\n<b>Опыт:</b> ${sanitize(d.experience)}\n<b>Зарплата:</b> ${sanitize(
      d.salary || "По договоренности"
    )}\n<b>Навыки:</b> ${sanitize(d.skills)}\n\n${sanitize(d.description)}\n\n<b>Контакты:</b> ${sanitize(d.contacts)}\n\n#резюме`;
  } else {
    const d = payload as RCForm;
    return `<b>☕️ Random Coffee: ${sanitize(d.rcName)}</b>\n\n<b>Специальность:</b> ${sanitize(d.rcSpecialty)}\n<b>Интересы:</b> ${sanitize(
      d.rcInterests
    )}\n${d.rcLinkedin ? `<b>LinkedIn:</b> ${sanitize(d.rcLinkedin)}` : ""}\n\n<i>Ваша анкета готова к участию в пятничном нетворкинге!</i>`;
  }
}

const getLabel = (field: string) => {
  const labels: Record<string, string> = {
    title: "Должность",
    company: "Компания",
    salary: "Зарплата",
    location: "Локация / Формат",
    experience: "Опыт работы",
    skills: "Ключевые навыки",
    description: "Описание",
    contacts: "Контакты",
    rcName: "Ваше Имя",
    rcSpecialty: "Специальность",
    rcInterests: "Профессиональные интересы",
    rcLinkedin: "Ссылка на LinkedIn",
  };
  return labels[field] || field;
};

// --- Sub-Components ---

const Step1TypeSelection = ({ setActiveTab, goNext }: { setActiveTab: (t: AppTab) => void; goNext: () => void }) => (
  <div className="flex flex-col gap-4 mt-8">
    <button
      onClick={() => {
        setActiveTab("VACANCY");
        goNext();
      }}
      className="bg-white p-6 rounded-2xl shadow-sm border border-transparent hover:border-blue-500 transition active:scale-95 flex items-center gap-4"
    >
      <div className="bg-blue-100 p-4 rounded-full text-blue-600">
        <Briefcase />
      </div>
      <div className="text-left">
        <h3 className="text-lg font-bold text-gray-900">Ищу сотрудника</h3>
        <p className="text-sm text-gray-500">Опубликовать вакансию</p>
      </div>
    </button>

    <button
      onClick={() => {
        setActiveTab("RESUME");
        goNext();
      }}
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
      onClick={() => {
        setActiveTab("RANDOM_COFFEE");
        goNext();
      }}
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

interface Step2Props {
  data: AnyFormData;
  setData: (updater: AnyFormData | FormUpdater) => void;
  activeTab: AppTab;
  resumeMode?: ResumeMode;
  setResumeMode?: (mode: ResumeMode) => void;
  aiChanges?: AIChange[];
  handleAiFix?: () => void;
  isAiLoading?: boolean;
  aiAvailable?: boolean;
  hasCorrectedVersion?: boolean;
  resumeAiPrice?: number;
}

const Step2Form = ({
  data,
  setData,
  activeTab,
  resumeMode,
  setResumeMode,
  aiChanges,
  handleAiFix,
  isAiLoading,
  aiAvailable,
  hasCorrectedVersion,
  resumeAiPrice = 50,
}: Step2Props) => {
  const renderInput = (field: string, placeholder: string, multiline = false) => {
    const dataRecord = data as unknown as Record<string, string>;
    const currentLength = dataRecord[field]?.length || 0;
    const limit = CHAR_LIMITS[field] || 0;
    const isOverLimit = currentLength > limit;

    const handleChange = (newValue: string) => {
      setData(
        ((prev: AnyFormData) =>
          ({
            ...prev,
            [field]: newValue,
          } as unknown as AnyFormData)) as FormUpdater
      );
    };

    return (
      <div className="mb-4 relative">
        <div className="flex justify-between mb-1">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">{getLabel(field)}</label>
          <span className={`text-xs ${isOverLimit ? "text-red-500" : "text-gray-300"}`}>
            {currentLength}/{limit}
          </span>
        </div>

        {multiline ? (
          <textarea
            className={`w-full p-3 bg-white border rounded-xl outline-none text-sm min-h-[140px] resize-none text-black transition-colors ${
              isOverLimit ? "border-red-500 bg-red-50" : "border-gray-200 focus:ring-2 focus:ring-blue-500"
            }`}
            placeholder={placeholder}
            value={dataRecord[field] || ""}
            onChange={(e) => handleChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            className={`w-full p-3 bg-white border rounded-xl outline-none text-sm text-black transition-colors ${
              isOverLimit ? "border-red-500 bg-red-50" : "border-gray-200 focus:ring-2 focus:ring-blue-500"
            }`}
            placeholder={placeholder}
            value={dataRecord[field] || ""}
            onChange={(e) => handleChange(e.target.value)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {activeTab === "RESUME" && setResumeMode && (hasCorrectedVersion || (aiChanges && aiChanges.length > 0)) && (
        <div className="flex bg-gray-200 p-1 rounded-lg mb-4">
          <button
            onClick={() => setResumeMode("ORIGINAL")}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition ${
              resumeMode === "ORIGINAL" ? "bg-white text-black shadow-sm" : "text-gray-500"
            }`}
          >
            Оригинал
          </button>
          <button
            onClick={() => setResumeMode("CORRECTED")}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition ${
              resumeMode === "CORRECTED" ? "bg-white text-purple-600 shadow-sm" : "text-gray-500"
            }`}
          >
            Исправленная ✨
          </button>
        </div>
      )}

      <div className="bg-white p-5 rounded-2xl shadow-sm space-y-2 pb-8">
        {activeTab === "VACANCY" && (
          <>
            {renderInput("title", "Например: Senior React Developer")}
            <div className="grid grid-cols-2 gap-3">
              {renderInput("company", "Google")}
              {renderInput("location", "Москва, Офис")}
            </div>
            {renderInput("salary", "от 200 000 руб")}
            {renderInput("description", "Подробное описание...", true)}
            {renderInput("contacts", "@username, ссылка или email")}
          </>
        )}

        {activeTab === "RESUME" && (
          <>
            {renderInput("title", "Например: Senior React Developer")}
            {renderInput("salary", "от 200 000 руб")}
            {renderInput("experience", "5 лет...")}
            {renderInput("skills", "JS, TS...")}
            {renderInput("description", "О себе...", true)}
            {renderInput("contacts", "@username, ссылка или email")}
          </>
        )}

        {activeTab === "RANDOM_COFFEE" && (
          <>
            <p className="text-xs text-gray-500 mb-4 bg-orange-50 p-3 rounded-lg border border-orange-100">Данные для нетворкинга.</p>
            {renderInput("rcName", "Иван")}
            {renderInput("rcSpecialty", "Product Manager")}
            {renderInput("rcInterests", "AI, стартапы...", true)}
            {renderInput("rcLinkedin", "https://linkedin.com/...")}
          </>
        )}
      </div>

      {activeTab === "RESUME" && resumeMode === "CORRECTED" && aiChanges && aiChanges.length > 0 && (
        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-sm">
          <h4 className="font-bold text-purple-800 mb-2 flex items-center gap-2">
            <MagicWand /> Что улучшил AI:
          </h4>
          <ul className="space-y-3">
            {aiChanges.map((change, i) => (
              <li key={i} className="text-purple-900 bg-white/50 p-2 rounded-lg">
                <span className="font-bold text-xs uppercase bg-purple-200 px-1 rounded mr-2">{change.field}</span>
                {change.what_fixed}
                <div className="text-xs text-purple-500 mt-1 italic">{change.why}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeTab === "RESUME" && handleAiFix && (
        <button
          onClick={handleAiFix}
          disabled={!aiAvailable || isAiLoading}
          className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition
            ${aiAvailable && !isAiLoading ? "bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-200 active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"}
          `}
        >
          {isAiLoading
            ? "Улучшаем..."
            : hasCorrectedVersion || (aiChanges && aiChanges.length > 0)
              ? `✨ Обновить AI-версию (${resumeAiPrice} ⭐️)`
              : `✨ AI-исправление (${resumeAiPrice} ⭐️)`}
        </button>
      )}
    </div>
  );
};

const Step3Channels = ({
  channels,
  selectedIds,
  setSelectedIds,
  discountPercent,
}: {
  channels: Channel[];
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  discountPercent: number;
}) => {
  const grouped = channels.reduce((acc: Record<string, Channel[]>, ch) => {
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
            {list.map((ch) => {
              const isSelected = selectedIds.includes(ch.id);
              const discounted = discountPercent > 0 ? calcDiscounted(ch.priceStars, discountPercent) : ch.priceStars;

              return (
                <div
                  key={ch.id}
                  onClick={() => setSelectedIds((prev) => (prev.includes(ch.id) ? prev.filter((i) => i !== ch.id) : [...prev, ch.id]))}
                  className={`p-4 flex items-center justify-between cursor-pointer transition active:bg-gray-50 ${isSelected ? "bg-blue-50/50" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition ${isSelected ? "bg-blue-500 border-blue-500" : "border-gray-300"}`}>
                      {isSelected && <CheckCircle />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{ch.name}</div>
                      <div className="text-xs text-gray-400 truncate">{ch.username}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {discountPercent > 0 && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                        -{discountPercent}%
                      </span>
                    )}
                    <div className="text-right">
                      {discountPercent > 0 && <div className="text-[10px] text-gray-400 line-through">⭐️ {ch.priceStars}</div>}
                      <div className="text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">⭐️ {discounted}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {discountPercent > 0 && (
            <div className="text-[11px] text-gray-400 mt-2 ml-1">
              Скидка применяется к каждому каналу. Итог считается по сниженным ценам.
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Step4Preview = ({ activeTab, data, isParticipating }: { activeTab: AppTab; data: AnyFormData; isParticipating: boolean }) => {
  const rawText = formatOrderText(activeTab, data);
  const htmlContent = rawText.replace(/\n/g, "<br/>");

  if (activeTab === "RANDOM_COFFEE") {
    const rcData = data as RCForm;
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
              <div className="text-gray-900 font-medium">{rcData.rcName}</div>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase font-bold">Специальность</span>
              <div className="text-gray-900">{rcData.rcSpecialty}</div>
            </div>
            <div>
              <span className="text-gray-400 text-xs uppercase font-bold">Интересы</span>
              <div className="text-gray-900">{rcData.rcInterests}</div>
            </div>
            {rcData.rcLinkedin && (
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">LinkedIn</span>
                <div className="text-blue-500 truncate">{rcData.rcLinkedin}</div>
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
        <div className="text-sm text-gray-900 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: htmlContent }} />
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

export default function TgAppPage() {
  const [step, setStep] = useState(1);
  const [activeTab, setActiveTab] = useState<AppTab>("VACANCY");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  const [isParticipating, setIsParticipating] = useState(false);

  // Settings from backend
  const [settings, setSettings] = useState<TgSettings>({
    vacancyBasePriceStars: 0,
    resumeBasePriceStars: 0,
    channelDiscountPercent: 0,
  });

  // Price from backend (env-driven)
  const [resumeAiPrice, setResumeAiPrice] = useState<number>(50);

  // Independent States for each form
  const [vacancyForm, setVacancyForm] = useState<VacancyForm>({ title: "", company: "", salary: "", location: "", description: "", contacts: "" });
  const [rcForm, setRcForm] = useState<RCForm>({ rcName: "", rcSpecialty: "", rcInterests: "", rcLinkedin: "" });

  // Resume State (AI)
  const [resumeMode, setResumeMode] = useState<ResumeMode>("ORIGINAL");
  const [resumeOriginal, setResumeOriginal] = useState<ResumeForm>({ title: "", salary: "", experience: "", skills: "", description: "", contacts: "" });
  const [resumeCorrected, setResumeCorrected] = useState<ResumeForm>({ title: "", salary: "", experience: "", skills: "", description: "", contacts: "" });

  const [lastAiInputSnapshot, setLastAiInputSnapshot] = useState<string | null>(null);
  const [aiChanges, setAiChanges] = useState<AIChange[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const getActiveData = (): AnyFormData => {
    if (activeTab === "VACANCY") return vacancyForm;
    if (activeTab === "RANDOM_COFFEE") return rcForm;
    return resumeMode === "CORRECTED" ? resumeCorrected : resumeOriginal;
  };

  const setActiveData = (updater: AnyFormData | FormUpdater) => {
    if (activeTab === "VACANCY") {
      setVacancyForm(updater as SetStateAction<VacancyForm>);
    } else if (activeTab === "RANDOM_COFFEE") {
      setRcForm(updater as SetStateAction<RCForm>);
    } else {
      const resumeUpdater = updater as SetStateAction<ResumeForm>;
      if (resumeMode === "CORRECTED") setResumeCorrected(resumeUpdater);
      else setResumeOriginal(resumeUpdater);
    }
  };

  // Auto-save (Resume)
  useEffect(() => {
    if (!tgUser?.id || activeTab !== "RESUME") return;
    const timeoutId = setTimeout(() => {
      fetch("/api/tg-jobs", {
        method: "POST",
        body: JSON.stringify({
          action: "save_resume_draft",
          userId: tgUser.id,
          original: resumeOriginal,
          corrected: resumeCorrected,
        }),
      }).catch(console.error);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [activeTab, resumeOriginal, resumeCorrected, tgUser]);

  const isFormValid = () => {
    const required: (keyof ResumeForm)[] = ["title", "description", "contacts", "experience", "skills"];
    return required.every((f) => !!resumeOriginal[f]?.trim());
  };

  const hasOriginalChangedSinceGeneration = () => {
    if (!lastAiInputSnapshot) return true;
    return JSON.stringify(resumeOriginal) !== lastAiInputSnapshot;
  };

  const aiAvailable = activeTab === "RESUME" && isFormValid() && (aiChanges.length === 0 || hasOriginalChangedSinceGeneration());
  const hasCorrectedVersion = !!resumeCorrected.title && !!resumeCorrected.description;

  // init channels + tg user
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch("/api/tg-jobs");
        const data = await res.json();

        // Backward compatible: data can be array or {channels, settings}
        const receivedChannels: Channel[] = Array.isArray(data) ? data : data.channels;
        const receivedSettings: TgSettings | undefined = Array.isArray(data) ? undefined : data.settings;

        if (receivedSettings) setSettings(receivedSettings);
        setChannels(receivedChannels || []);

        if (typeof window !== "undefined" && window.Telegram?.WebApp) {
          const tg = window.Telegram.WebApp;
          tg.ready();
          tg.expand();
          setTgUser(tg.initDataUnsafe?.user as TelegramUser);
          document.body.style.backgroundColor = tg.themeParams.secondary_bg_color || "#f3f4f6";
          document.body.style.color = tg.themeParams.text_color || "#000000";

          const startParam = tg.initDataUnsafe?.start_param;
          if (startParam && Array.isArray(receivedChannels)) {
            const target = receivedChannels.find((c: Channel) => c.id === startParam || c.username.replace("@", "") === startParam);
            if (target) setSelectedIds([target.id]);
          }
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    init();
  }, []);

  // load profile/settings/prices
  useEffect(() => {
    if (tgUser?.id) {
      fetch(`/api/tg-jobs?action=get_profile&userId=${tgUser.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data) return;

          if (data?.settings) setSettings(data.settings);
          if (data?.prices?.resumeAi) setResumeAiPrice(data.prices.resumeAi);

          if (data.profile) {
            setIsParticipating(data.isParticipating);
            setRcForm((prev) => ({
              ...prev,
              rcName: data.profile.name || "",
              rcSpecialty: data.profile.specialty || "",
              rcInterests: data.profile.interests || "",
              rcLinkedin: data.profile.linkedin || "",
            }));
          }

          if (data.resumeDraft) {
            if (data.resumeDraft.original) setResumeOriginal((prev) => ({ ...prev, ...data.resumeDraft.original }));
            if (data.resumeDraft.corrected) {
              setResumeCorrected((prev) => ({ ...prev, ...data.resumeDraft.corrected }));
              setResumeMode("CORRECTED");
            }
          }
        })
        .catch(console.error);
    }
  }, [tgUser]);

  const pollForGeneration = async (orderId: string, attempts = 5) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const genRes = await fetch("/api/tg-jobs", { method: "POST", body: JSON.stringify({ action: "generate_ai_resume", orderId }) });
        if (genRes.status === 400) {
          const j = await genRes.json().catch(() => null);
          if (j?.code === "ORDER_NOT_READY") {
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }
          throw new Error(j?.error || "Bad request");
        }
        const genData = await genRes.json();
        if (genData.success) return genData;
        throw new Error(genData.error || "Generation failed");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (i === attempts - 1 || (msg && msg !== "Failed to fetch")) throw e;
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
    throw new Error("Timeout");
  };

  const handleAiFix = async () => {
    setIsAiLoading(true);
    try {
      const res = await fetch("/api/tg-jobs", {
        method: "POST",
        body: JSON.stringify({ action: "create_ai_invoice", userId: tgUser?.id || "12345", username: tgUser?.username, payload: resumeOriginal }),
      });
      const data = await res.json();
      if (data.invoiceLink) {
        window.Telegram.WebApp.openInvoice(data.invoiceLink, async (status: string) => {
          try {
            if (status === "paid") {
              window.Telegram?.WebApp?.showAlert("Оплата прошла! Генерируем улучшенную версию...");
              try {
                const genData = await pollForGeneration(data.orderId);
                setLastAiInputSnapshot(JSON.stringify(resumeOriginal));
                const aiRes = genData.aiResult.resume;
                setResumeCorrected((prev) => ({ ...prev, ...aiRes }));
                setAiChanges(genData.aiResult.changes);
                setResumeMode("CORRECTED");
                window.Telegram?.WebApp?.showAlert("Резюме улучшено!");
              } catch (e) {
                console.error(e);
                window.Telegram?.WebApp?.showAlert("Ошибка генерации. Средства возвращены.");
              }
            }
          } finally {
            setIsAiLoading(false);
          }
        });
      } else {
        setIsAiLoading(false);
        alert("Ошибка создания счета");
      }
    } catch {
      setIsAiLoading(false);
      alert("Ошибка соединения");
    }
  };

  const validateForm = () => {
    const fd = getActiveData();
    const fdRecord = fd as unknown as Record<string, string>;

    let required: string[] = [];
    let currentTabFields: string[] = [];

    if (activeTab === "VACANCY") {
      required = ["title", "description", "contacts"];
      currentTabFields = ["title", "company", "salary", "location", "description", "contacts"];
    } else if (activeTab === "RESUME") {
      required = ["title", "description", "contacts", "experience", "skills"];
      currentTabFields = ["title", "salary", "experience", "skills", "description", "contacts"];
    } else if (activeTab === "RANDOM_COFFEE") {
      required = ["rcName", "rcSpecialty", "rcInterests"];
      currentTabFields = ["rcName", "rcSpecialty", "rcInterests", "rcLinkedin"];
    }

    for (const field of required) {
      if (!fdRecord[field]?.trim()) {
        window.Telegram?.WebApp?.showAlert(`Поле "${getLabel(field)}" обязательно`);
        return false;
      }
    }

    for (const field of currentTabFields) {
      const limit = CHAR_LIMITS[field];
      const val = fdRecord[field];
      if (limit && (val?.length || 0) > limit) {
        window.Telegram?.WebApp?.showAlert(`Поле "${getLabel(field)}" превышает лимит.`);
        return false;
      }
    }

    if (activeTab !== "RANDOM_COFFEE") {
      const contact = (fd as VacancyForm | ResumeForm).contacts;
      const contactRegex = /(@[\w\d_]+|https?:\/\/[^\s]+|[\w\d._%+-]+@[\w\d.-]+\.[\w]{2,4})/i;
      if (!contactRegex.test(contact)) {
        window.Telegram?.WebApp?.showAlert("В контактах укажите @username, ссылку или email");
        return false;
      }
    }

    const currentTabTotalLen = currentTabFields.reduce((acc, field) => acc + (fdRecord[field]?.length || 0), 0);
    if (currentTabTotalLen > MAX_TOTAL_CHARS) {
      window.Telegram?.WebApp?.showAlert(`Общий размер текста слишком большой.`);
      return false;
    }

    return true;
  };

  const goNext = () => {
    if (step === 2 && !validateForm()) return;
    if (step === 3 && activeTab !== "RANDOM_COFFEE" && selectedIds.length === 0) {
      window.Telegram?.WebApp?.showAlert("Выберите канал");
      return;
    }
    const nextStep = step === 2 && activeTab === "RANDOM_COFFEE" ? 4 : step + 1;
    setStep(nextStep);
    window.scrollTo(0, 0);
  };

  const goBack = () => {
    const prevStep = step === 4 && activeTab === "RANDOM_COFFEE" ? 2 : step - 1;
    setStep(prevStep);
  };

  const discountPercent = settings.channelDiscountPercent || 0;

  const basePrice = useMemo(() => {
    if (activeTab === "VACANCY") return settings.vacancyBasePriceStars || 0;
    if (activeTab === "RESUME") return settings.resumeBasePriceStars || 0;
    return 0;
  }, [activeTab, settings]);

  const channelsSumDiscounted = useMemo(() => {
    if (activeTab === "RANDOM_COFFEE") return 0;
    const picked = channels.filter((c) => selectedIds.includes(c.id));
    return picked.reduce((sum, c) => {
      const p = discountPercent > 0 ? calcDiscounted(c.priceStars, discountPercent) : c.priceStars;
      return sum + p;
    }, 0);
  }, [channels, selectedIds, discountPercent, activeTab]);

  const totalPrice = activeTab === "RANDOM_COFFEE" ? 100 : basePrice + channelsSumDiscounted;

  const handlePay = async () => {
    try {
      const res = await fetch("/api/tg-jobs", {
        method: "POST",
        body: JSON.stringify({
          action: "create_invoice",
          channelIds: activeTab === "RANDOM_COFFEE" ? [] : selectedIds,
          type: activeTab,
          payload: getActiveData(),
          userId: tgUser?.id || "12345",
          username: tgUser?.username,
        }),
      });
      const data = await res.json();
      if (data.invoiceLink) window.Telegram.WebApp.openInvoice(data.invoiceLink, (s: string) => { if (s === "paid") window.Telegram.WebApp.close(); });
    } catch {
      alert("Error");
    }
  };

  const handleCancel = async () => {
    window.Telegram?.WebApp?.showConfirm("Вы уверены? Мы вернем 100 звезд.", async (confirmed: boolean) => {
      if (confirmed) {
        try {
          const res = await fetch("/api/tg-jobs", { method: "POST", body: JSON.stringify({ action: "cancel_random_coffee", userId: tgUser?.id || "12345" }) });
          const data = await res.json();
          if (data.ok) {
            setIsParticipating(false);
            window.Telegram?.WebApp?.showAlert("Отменено.");
          } else {
            window.Telegram?.WebApp?.showAlert("Ошибка: " + (data.error || "Unknown"));
          }
        } catch {
          window.Telegram?.WebApp?.showAlert("Ошибка соединения");
        }
      }
    });
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="min-h-screen font-sans bg-[#f3f4f6] text-gray-900 pb-24">
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between">
        {step > 1 ? (
          <button onClick={goBack} className="p-1 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft />
          </button>
        ) : (
          <div className="w-8" />
        )}
        <div className="font-semibold text-sm">Шаг {step === 4 && activeTab === "RANDOM_COFFEE" ? "3" : step}</div>
        <div className="w-8" />
      </div>

      <div className="h-1 bg-gray-200 w-full">
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(step / 4) * 100}%` }} />
      </div>

      <div className="p-4 max-w-lg mx-auto">
        {step === 1 && (
          <div className="text-center mt-4">
            <h1 className="text-2xl font-bold mb-2">Сервисы</h1>
            <Step1TypeSelection setActiveTab={setActiveTab} goNext={goNext} />
          </div>
        )}

        {step === 2 && (
          <>
            <h2 className="text-xl font-bold mb-4 px-1">{activeTab === "RANDOM_COFFEE" ? "Профиль" : "Данные"}</h2>
            <Step2Form
              data={getActiveData()}
              setData={setActiveData}
              activeTab={activeTab}
              resumeMode={resumeMode}
              setResumeMode={setResumeMode}
              aiChanges={aiChanges}
              handleAiFix={handleAiFix}
              isAiLoading={isAiLoading}
              aiAvailable={aiAvailable}
              hasCorrectedVersion={hasCorrectedVersion}
              resumeAiPrice={resumeAiPrice}
            />
          </>
        )}

        {step === 3 && activeTab !== "RANDOM_COFFEE" && (
          <>
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-xl font-bold">Каналы</h2>
              {discountPercent > 0 && (
                <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                  Скидка -{discountPercent}%
                </span>
              )}
            </div>
            <Step3Channels
              channels={channels}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              discountPercent={discountPercent}
            />
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-xl font-bold mb-4 px-1">Итог</h2>
            <Step4Preview activeTab={activeTab} data={getActiveData()} isParticipating={isParticipating} />
          </>
        )}
      </div>

      {step > 1 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 safe-area-bottom z-30 shadow-lg">
          <div className="max-w-lg mx-auto flex items-center gap-4">
            {(step === 3 || step === 4) && activeTab !== "RANDOM_COFFEE" && (
              <div className="flex-1">
                <div className="text-[11px] text-gray-400">К оплате:</div>

                <div className="flex items-center justify-between mt-1">
                  <div className="text-xs text-gray-500">База</div>
                  <div className="text-xs font-bold">⭐️ {basePrice}</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">Каналы{discountPercent > 0 ? ` (-${discountPercent}%)` : ""}</div>
                  <div className="text-xs font-bold">⭐️ {channelsSumDiscounted}</div>
                </div>

                <div className="h-px bg-gray-200 my-2" />

                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold">Итого</div>
                  <div className="text-lg font-bold">⭐️ {totalPrice}</div>
                </div>
              </div>
            )}

            {activeTab === "RANDOM_COFFEE" && step === 4 && (
              <div className="flex-1">
                <div className="text-xs text-gray-400">Взнос:</div>
                <div className="text-lg font-bold">⭐️ 100</div>
              </div>
            )}

            {step === 4 && activeTab === "RANDOM_COFFEE" && isParticipating ? (
              <button onClick={handleCancel} className="w-full bg-red-50 text-red-600 border border-red-200 font-bold py-3 px-6 rounded-xl">
                Отменить
              </button>
            ) : (
              <button
                onClick={step === 4 ? handlePay : goNext}
                disabled={step === 3 && !selectedIds.length && activeTab !== "RANDOM_COFFEE"}
                className="bg-blue-600 text-white font-bold py-3 px-6 rounded-xl w-full disabled:opacity-50"
              >
                {step === 2 && activeTab === "RESUME" && aiChanges && aiChanges.length > 0
                  ? `Далее (${resumeMode === "ORIGINAL" ? "Ориг." : "Испр."})`
                  : step === 4
                    ? "Оплатить"
                    : "Далее"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}