# Przebieg

Dziennik biegowy w stylu Endomondo. Wgrywasz pliki FIT z zegarka, a aplikacja liczy rekordy, międzyczasy, formę i statystyki. Kod leży na GitHub Pages i nie zawiera żadnych danych. Wszystko, co Twoje, trzyma folder **Przebieg** na Twoim Dysku Google.

## Pliki

| Plik | Co robi |
|---|---|
| `index.html` | Wygląd i układ strony |
| `app.js` | Interfejs, logowanie Google, synchronizacja z Dyskiem, import, pogoda |
| `core.js` | Odczyt FIT, rekordy, międzyczasy, VDOT, statystyki |
| `analysis.js` | Strefy tętna, obciążenie, raporty treningów i kondycji, skład ciała |
| `plan.js` | Generator planu z historii, plan ze stałymi dniami i nadrabianiem opuszczonych treningów |
| `vendor.js` | Biblioteki: dekoder FIT Garmina i rozpakowywanie ZIP |

## Wdrożenie

1. Załóż na GitHubie nowe, publiczne repo `przebieg` i wrzuć do niego wszystkie pliki (oraz ten README).
2. W repo wejdź w **Settings → Pages**, wybierz **Deploy from a branch**, gałąź `main`, folder `/ (root)`, a potem **Save**.
3. Po minucie aplikacja działa pod adresem **https://zadupiezeusa.github.io/przebieg/**.

W Google Cloud nie trzeba nic zmieniać. Aplikacja używa tego samego Client ID co FotoPlaner, a autoryzowany adres `https://zadupiezeusa.github.io` obejmuje wszystkie repo na tym koncie. Drive API jest już włączone. Przy pierwszym logowaniu Google zapyta o dostęp do plików tworzonych przez aplikację.

Nie zmieniaj później Client ID. Uprawnienie `drive.file` jest przypięte do konkretnego klienta OAuth, więc po zmianie aplikacja straciłaby dostęp do swoich plików.

## Dane na Dysku

```
Przebieg/
  baza.json      ← podsumowania, międzyczasy, najlepsze odcinki, trasy uproszczone
  surowe/        ← oryginalne pliki .fit (źródło prawdy)
```

- Oryginały są nietykalne. Po zmianie algorytmu wybierasz **☁ → Przelicz wszystkie treningi** i aplikacja liczy wszystko od nowa.
- Szczegółowe dane do wykresów są trzymane tylko w pamięci przeglądarki. Na nowym urządzeniu aplikacja dociąga je sama z oryginału przy pierwszym otwarciu treningu.
- Usunięty trening trafia do kosza na Dysku, skąd można go odzyskać.

## Skąd brać pliki FIT

- **Garmin Connect (przeglądarka):** otwórz trening, kliknij ⚙ i wybierz **Eksportuj oryginał**. Dostaniesz ZIP, który wgrywasz tak, jak jest.
- **Cała historia:** eksport danych konta Garmin (Zarządzanie danymi → Eksportuj dane). Wgraj cały ZIP; aplikacja wyciągnie z niego pliki FIT, także z zagnieżdżonych archiwów.
- **Strava:** trening → ⋯ → **Eksportuj oryginał**, jeśli trening przyszedł z zegarka jako FIT.

## Co liczy

- **Najlepsze odcinki:** 400 m, 1 km, 1 mila, 3 km, 5 km, 10 km, 15 km, półmaraton, 30 km, maraton. Liczone z każdego fragmentu biegu, nie tylko z całości, i z czasu stopera, więc auto-pauza na światłach nie psuje wyniku.
- **Rekordy życiowe:** top 10 na każdy dystans i wykres progresji.
- **Forma:** VDOT Danielsa z najlepszego odcinka ≥ 3 km z ostatnich 90 dni oraz prognozy na 5 km, 10 km, półmaraton i maraton.
- **Statystyki:** km tygodniowo, porównanie rok do roku, kalendarz biegów, podsumowania lat i miesięcy.

## Wersja 2

- **Menu:** Pulpit, Treningi, Postęp, Ciało i przycisk „+” (trening, pomiar ciała, import z wagi).
- **Raport treningu:** typ biegu rozpoznany po strefach z progu mleczanowego, czas w strefach, dryf tętna, porównanie z podobnymi biegami, pogoda, notatka i rekomendacja kolejnego treningu.
- **Raport kondycji:** tempo przy stałym tętnie, forma, zmęczenie i świeżość, rozkład intensywności 80/20, VDOT, wpływ kawy na tętno.
- **Ciało:** pomiary ręczne albo CSV z eksportu Zepp (`timestamp, weight, fatRate, muscleRate…`), średnia 7-dniowa, trend, masa tłuszczu i beztłuszczowa, obwód pasa.
- **Pogoda:** Open-Meteo, bez klucza, pobierana dla treningów z GPS.
- **Mapa:** OpenStreetMap, bez klucza API.
- **Ustawienia:** próg mleczanowy (domyślnie 164 przy 6:56/km), tempo progu, tętno spoczynkowe i maksymalne, wzrost.

Po wgraniu nowej wersji aplikacja zaproponuje jednorazowe przeliczenie treningów z oryginałów FIT. Bez tego stare treningi nie mają stref ani raportu.

## Plan treningowy

- **Cel:** „Kondycja i mniej brzucha”, 12 tygodni, 2–4 stałe dni w tygodniu (domyślnie wt · czw · nd).
- **Tydzień:** łatwy bieg, akcent (przebieżki, interwały progowe, fartlek) i długi bieg od 40 do 80 minut. Co 4. tydzień jest lżejszy, a na koniec jest sprawdzian 5 km.
- **Opuszczony trening:** przesuwa się tylko on. Można go nadrobić do dnia przed kolejnym treningiem z planu, a jeśli się nie uda, przepada. Reszta planu zostaje na swoich dniach.
- **Odhaczanie:** przy aktywnym planie każdy wgrany bieg zalicza trening z planu. Gdy nie wiadomo który, aplikacja pyta (albo „Poza planem”). Ręcznie służą do tego przyciski „Zrobione bez zegarka”, „Jutro” i „Pomiń”.
- **Gdzie żyje plan:** tylko w aplikacji, synchronizowany przez `baza.json` na Dysku, bez Kalendarza Google.

## Wersja 3

- **Generator planu:** cel (kondycja, 5 km, 10 km, półmaraton), wynik docelowy lub data zawodów, stałe dni, dzień długiego biegu, limit czasu w pozostałe dni i opcja „nie lubię interwałów”. Startuje z Twoich ostatnich 8 tygodni (objętość, najdłuższy bieg, forma, ile biegasz łatwo) i ocenia, czy cel jest realny. Tempa liczy z Twoich danych: łatwe z biegów w strefie 2, próg z ustawień.
- **Siła:** zakładka w Treningach dla treningów siłowych z plików FIT. Każdą aktywność można ręcznie oznaczyć jako siłową.
- **Auto-próg:** po równym, mocnym biegu aplikacja podpowiada wyższy próg mleczanowy.
- **Podsumowanie tygodnia** na Pulpicie (w niedzielę bieżący tydzień, w pn–śr poprzedni).
- **Cele:** waga i obwód pasa z prognozą daty osiągnięcia.
- **Technika:** kadencja, długość kroku, kontakt z podłożem, oscylacja, współczynnik pionowy i moc z zegarka, ze wskazówkami.
- **Trasy:** wykrywanie stałych pętli, ranking i porównanie km po km z najlepszym przebiegnięciem.
- **Kiedy biegasz najlepiej:** pora dnia, pogoda, kawa i sen.
- **Odznaki** i wyzwania miesięczne.
- **Buty:** licznik kilometrów, domyślna para dla nowych biegów, ostrzeżenie przy limicie.

Po wgraniu aplikacja poprosi o jednorazowe przeliczenie treningów (silnik v3, bo dochodzi technika biegu).

### Poprawki planu (11.11)
- **Data startu planu:** dziś, ten poniedziałek, najbliższy poniedziałek albo dowolna data. Przy starcie od poniedziałku minione treningi z tego tygodnia są zaległe, a bieg zrobiony w tym tygodniu zalicza najstarszy z nich.
- **Bieg zrobiony przed terminem** ma etykietę „zrobiony dzień wcześniej”, a nie „nadrobiony”.
- **„Zmień dni”:** historia zostaje, pozostałe treningi przechodzą na nowe dni. W bieżącym tygodniu trafiają tylko na dni, które jeszcze nie minęły, a jeśli dziś był już bieg, liczą się od jutra.

### Ocena treningu i realizacja planu (13.11)
- **Podsumowanie** na górze raportu każdego biegu: kilka zdań o tym, jak poszedł bieg, jak wypada na tle podobnych, kadencja i ile odpoczynku potrzebujesz. Dłuższa analiza jest niżej, w „Szczegółach”.
- **Ocena wykonania 0–100%** dla biegu z planu (jak w Zepp): intensywność 40, czas lub dystans 30, struktura 20 (przebieżki, odcinki, ciągłość progu, równość tempa), termin 10. Do tego wskazówka, co poprawić następnym razem.
- **Przypisanie biegu:** gdy pasują dwa treningi, bieg jest dużo krótszy niż plan albo zrobiony poza dniem, po imporcie pojawia się pytanie „Który to trening z planu?”. W raporcie przycisk „Zmień” pozwala to poprawić.
- **Realizacja planu:** średnia ocen wszystkich minionych treningów, opuszczony liczy się jako 0%. Widać ją w raporcie i w zakładce Plan.
- **Skuteczność planu:** prognoza na dystans celu od startu planu, procent drogi do celu i tempo przy tym samym tętnie przed planem i teraz. Gdy forma stoi 4 tygodnie, aplikacja to napisze.
