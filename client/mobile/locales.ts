/** `mobileNav` namespace dictionaries: drawer controls. */
export const NS = 'mobileNav'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'open': '打开目录',
  'close': '收起目录',
  'backdrop': '点击关闭目录',
  'sessionLog': '导出会话日志',
  'files': '文件浏览',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<MobileNavKey, string> = {
  'open': 'Open directory',
  'close': 'Close directory',
  'backdrop': 'Click to close directory',
  'sessionLog': 'Session log',
  'files': 'Files',
}

export const dictionaries: Record<string, Record<MobileNavKey, string>> = {
  en, zh,
  'zh-TW': { open: '開啟目錄', close: '收合目錄', backdrop: '點擊關閉目錄', sessionLog: '匯出會話記錄', files: '檔案瀏覽' },
  ja: { open: 'ディレクトリを開く', close: 'ディレクトリを閉じる', backdrop: 'クリックしてディレクトリを閉じる', sessionLog: 'セッションログ', files: 'ファイル' },
  ko: { open: '디렉터리 열기', close: '디렉터리 닫기', backdrop: '디렉터리를 닫으려면 클릭', sessionLog: '세션 로그', files: '파일' },
  es: { open: 'Abrir directorio', close: 'Cerrar directorio', backdrop: 'Haz clic para cerrar el directorio', sessionLog: 'Registro de sesión', files: 'Archivos' },
  fr: { open: 'Ouvrir le dossier', close: 'Fermer le dossier', backdrop: 'Cliquez pour fermer le dossier', sessionLog: 'Journal de session', files: 'Fichiers' },
  de: { open: 'Verzeichnis öffnen', close: 'Verzeichnis schließen', backdrop: 'Klicken, um das Verzeichnis zu schließen', sessionLog: 'Sitzungsprotokoll', files: 'Dateien' },
  'pt-BR': { open: 'Abrir diretório', close: 'Fechar diretório', backdrop: 'Clique para fechar o diretório', sessionLog: 'Log da sessão', files: 'Arquivos' },
  ru: { open: 'Открыть каталог', close: 'Закрыть каталог', backdrop: 'Нажмите, чтобы закрыть каталог', sessionLog: 'Журнал сеанса', files: 'Файлы' },
  ar: { open: 'فتح المجلد', close: 'إغلاق المجلد', backdrop: 'انقر لإغلاق المجلد', sessionLog: 'سجل الجلسة', files: 'الملفات' },
  hi: { open: 'डायरेक्टरी खोलें', close: 'डायरेक्टरी बंद करें', backdrop: 'डायरेक्टरी बंद करने के लिए क्लिक करें', sessionLog: 'सत्र लॉग', files: 'फ़ाइलें' },
}

/** Key domain of the `mobileNav` namespace (zh is the source of truth). */
export type MobileNavKey = keyof typeof zh
