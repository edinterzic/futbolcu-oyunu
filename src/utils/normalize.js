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

  const tokens = getNameTokens(answerName);
  if (!tokens.includes(normalizedInput)) return false;

  const sameTokenMatches = answersForRound.filter((answer) => getNameTokens(answer).includes(normalizedInput));
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

    text
      .replaceAll("-", " ")
      .split(" ")
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .forEach((part) => tokenSet.add(part));
  });

  return Array.from(tokenSet);
}
