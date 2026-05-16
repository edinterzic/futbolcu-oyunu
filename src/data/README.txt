Futbolcu oyunu veri dosyaları

team_count: 57
active_player_count: 3798
playable_pair_count: 1163
possible_pair_count: 1596
empty_pair_count: 433
duplicate_relation_count: 0
invalid_team_count: 0

Notlar:
1) Tüm dosyalar (teams.js, players.js, answerIndex.js, teamLogos.js)
   temizlenmiş "active_player_teams.xlsx" tablosundan otomatik üretildi.
2) Takım adları kanonik biçimde (örn. "Beşiktaş", "Manchester United",
   "Borussia Dortmund") — eski kısaltmalar düzeltildi.
3) Logo URL'leri çıkarıldı; sadece renk + harf rozeti kullanılıyor.
   Telif riski yok.
4) Veriye yeni oyuncu/takım eklerken active_player_teams.xlsx'i
   güncelleyip yeniden üret. Manuel düzenleme yapma.

Kullanım:
1) Bu klasördeki .js dosyalarını React projesinde src/data/ içine koy.
2) Takım seçerken boş eşleşme gelmemesi için ANSWER_INDEX
   anahtarlarından rastgele seçim yap.
3) Cevap kontrolünde getAnswers(teamA, teamB) kullan.
