// =============================================
// PairFC Metin Normalizasyon Yardımcıları
// =============================================
// Türkçe + İskandinav + Cermen + Slav + Romans karakterleri için tutarlı
// metin normalleştirme. Hem oyuncu input'unu hem player.name/aliases'ı
// karşılaştırılabilir tek bir form'a indirir.
//
// Kullananlar: App.jsx (Maraton/Daily/Düello cevap kontrolü) ve
// arenaQuestions.js (Arena cevap kontrolü). Daha önce iki yerde duplicate
// vardı — şimdi tek kaynak.

// "İlhan Mansız" → "ilhanmansiz", "Großkreutz" → "grosskreutz", "Þór" → "thor"
export function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Türkçe
    .replace(/[ı]/g, "i")
    .replace(/[ğ]/g, "g")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ö]/g, "o")
    .replace(/[ç]/g, "c")
    // NFD'nin parçalayamadığı bağımsız Latin harfleri:
    // İskandinav: Kjær, Brøndby, Eiður, Þór
    // Cermen:    Großkreutz
    // Slav:      Łukasz, Đorđević
    // Romans:    Œuvre
    .replace(/[æ]/g, "ae")
    .replace(/[œ]/g, "oe")
    .replace(/[ø]/g, "o")
    .replace(/[ð]/g, "d")
    .replace(/[þ]/g, "th")
    .replace(/[ß]/g, "ss")
    .replace(/[ł]/g, "l")
    .replace(/[đ]/g, "dj")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// "David Beckham" → ["david", "beckham"]
// "Jean-Luc Picard" → ["jean", "luc", "picard"]
export function getNameTokens(name) {
  return String(name || "")
    .replaceAll("-", " ")
    .split(" ")
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

// Çok parçalı soyadları yakalamak için "trailing suffix" birleşik token'ları.
// "Robin van Persie" → kelime token'ları [robin, van, persie] tek başına
// "van persie" (→ "vanpersie") yazımını YAKALAYAMAZ çünkü normalizeText
// boşlukları siler. Bu fonksiyon sondan başlayan her bitişik grubu birleştirir:
//   [robin, van, persie] → [robin, van, persie, vanpersie, robinvanpersie]
// Böylece "de gea" → "degea", "van der sar" → "dersar"/"vandersar",
// "de bruyne" → "debruyne" hepsi eşleşir. Sabit "van/de/von" listesi gerekmez.
export function getNameMatchTokens(name) {
  const words = getNameTokens(name);
  const set = new Set(words);
  // Sondan birleşik suffix'ler (en az 2 kelimelik gruplar — tek kelime zaten var)
  for (let start = words.length - 2; start >= 0; start--) {
    set.add(words.slice(start).join(""));
  }
  return Array.from(set);
}

// answerName ('David Beckham') ile userInput ('Beckham' veya 'David Beckham')
// eşleşiyor mu kontrol et.
// Soyad eşleşmesi sadece o tur'daki TEK cevap aynı soyadı taşıyorsa kabul
// edilir — "David" yazıldığında çiftte birden fazla David varsa hangisi
// olduğunu seçemediği için yanlış sayar.
export function answerNameMatchesInput(answerName, userInput, answersForRound = []) {
  const normalizedInput = normalizeText(userInput);
  if (!normalizedInput) return false;

  const normalizedAnswer = normalizeText(answerName);
  if (normalizedAnswer === normalizedInput) return true;

  const tokens = getNameMatchTokens(answerName);
  if (!tokens.includes(normalizedInput)) return false;

  // Aynı token o tur'da birden fazla cevaba aitse ayırt edilemez → reddet.
  // (örn. iki "David" varsa "david" yazımı belirsiz). Birleşik suffix token'lar
  // da bu kontrole dahil — "degea" tek bir cevaba aitse kabul.
  const sameTokenMatches = answersForRound.filter((answer) => getNameMatchTokens(answer).includes(normalizedInput));
  return sameTokenMatches.length === 1;
}

// Bir oyuncu için aranabilir token listesi üret (suggestion için)
// Player object: { name, aliases?: [] }
export function buildSuggestionSearchTokens(player) {
  const rawValues = [player.name, ...(player.aliases || [])];
  const tokenSet = new Set();

  rawValues.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;

    tokenSet.add(normalizeText(text));

    // Tek tek kelimeler + sondan birleşik suffix'ler ("van persie"→"vanpersie")
    getNameMatchTokens(text).forEach((tok) => tokenSet.add(tok));
  });

  return Array.from(tokenSet);
}
