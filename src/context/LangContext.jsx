import { createContext, useContext, useState } from "react";

const DICT = {
  en: {
    // nav
    dashboard: "Dashboard",
    evm: "EVM Machine",
    voters: "Households (aggregate)",
    voted: "Turnout",
    parties: "Results (on-chain)",
    blockchain: "Blockchain Logs",
    fraud: "Fraud Detection",
    reports: "Reports",
    settings: "Settings",
    audit: "Audit Log",
    logout: "Logout",
    welcome: "Welcome",
    // login page
    login_title: "SmartVote EVM",
    login_subtitle: "Small-scale electronic voting system",
    login_username: "Username",
    login_password: "Password",
    login_button: "Secure Login",
    login_signing_in: "Verifying...",
    // dashboard
    dash_title: "Dashboard",
    dash_households: "Households / booths tracked",
    dash_members: "Total registered members",
    dash_voted: "Votes cast (count only)",
    dash_turnout: "Turnout %",
    dash_alerts: "Open fraud alerts",
    dash_turnout_by_area: "Turnout % by constituency",
    dash_vote_share: "Vote share (tally)",
    // households
    hh_title: "Households — Aggregate Turnout",
    hh_export: "Export CSV",
    hh_search_placeholder: "Filter by constituency…",
    hh_search: "Search",
    // results
    res_title: "Results — vote counts",
    res_refresh: "Refresh",
    // blockchain
    chain_title: "Blockchain Logs",
    chain_verify: "Verify Chain",
    chain_search_placeholder: "Search by block hash, voter ID, or block index…",
    // fraud
    fraud_title: "Fraud Detection",
    fraud_run_scan: "Run Fraud Scan",
    fraud_scanning: "Scanning…",
    // reports
    reports_title: "Reports",
    reports_print: "Print / Save as PDF",
    // settings
    settings_title: "Settings",
    settings_election_name: "Election name",
    settings_voting_status: "Voting status",
    settings_theme: "Theme",
    settings_language: "Language",
    settings_reset: "Reset demo data",
  },
  hi: {
    dashboard: "डैशबोर्ड",
    evm: "ईवीएम मशीन",
    voters: "परिवार (कुल योग)",
    voted: "मतदान प्रतिशत",
    parties: "परिणाम (ऑन-चेन)",
    blockchain: "ब्लॉकचेन लॉग",
    fraud: "धोखाधड़ी जांच",
    reports: "रिपोर्ट",
    settings: "सेटिंग्स",
    audit: "ऑडिट लॉग",
    logout: "लॉग आउट",
    welcome: "स्वागत है",
    login_title: "स्मार्टवोट ईवीएम",
    login_subtitle: "छोटे स्तर की इलेक्ट्रॉनिक वोटिंग प्रणाली",
    login_username: "यूज़रनेम",
    login_password: "पासवर्ड",
    login_button: "सुरक्षित लॉगिन",
    login_signing_in: "जांच हो रही है...",
    dash_title: "डैशबोर्ड",
    dash_households: "ट्रैक किए गए परिवार / बूथ",
    dash_members: "कुल पंजीकृत सदस्य",
    dash_voted: "डाले गए वोट (केवल संख्या)",
    dash_turnout: "मतदान प्रतिशत",
    dash_alerts: "खुले धोखाधड़ी अलर्ट",
    dash_turnout_by_area: "क्षेत्र अनुसार मतदान प्रतिशत",
    dash_vote_share: "वोट हिस्सेदारी (गणना)",
    hh_title: "परिवार — कुल मतदान",
    hh_export: "CSV निर्यात करें",
    hh_search_placeholder: "क्षेत्र के अनुसार फ़िल्टर करें…",
    hh_search: "खोजें",
    res_title: "परिणाम — वोट गणना",
    res_refresh: "रिफ्रेश करें",
    chain_title: "ब्लॉकचेन लॉग",
    chain_verify: "चेन जांचें",
    chain_search_placeholder: "ब्लॉक हैश, वोटर आईडी, या इंडेक्स से खोजें…",
    fraud_title: "धोखाधड़ी जांच",
    fraud_run_scan: "स्कैन चलाएं",
    fraud_scanning: "स्कैन हो रहा है…",
    reports_title: "रिपोर्ट",
    reports_print: "प्रिंट / PDF सेव करें",
    settings_title: "सेटिंग्स",
    settings_election_name: "चुनाव का नाम",
    settings_voting_status: "मतदान स्थिति",
    settings_theme: "थीम",
    settings_language: "भाषा",
    settings_reset: "डेमो डेटा रीसेट करें",
  },
};

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(localStorage.getItem("sv_lang") || "en");

  const setLanguage = (l) => {
    setLang(l);
    localStorage.setItem("sv_lang", l);
  };

  const t = (key) => DICT[lang]?.[key] ?? DICT.en[key] ?? key;

  return <LangContext.Provider value={{ lang, setLanguage, t }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
