# Przebieg

Dziennik biegowy w stylu Endomondo. Wgrywasz pliki FIT z zegarka, a aplikacja liczy rekordy, międzyczasy, formę i statystyki. Kod leży na GitHub Pages i nie zawiera żadnych danych. Wszystko, co Twoje, trzyma folder **Przebieg** na Twoim Dysku Google.

## Pliki

| Plik | Co robi |
|---|---|
| `index.html` | Interfejs, logowanie Google, synchronizacja z Dyskiem |
| `core.js` | Odczyt FIT i wszystkie obliczenia (rekordy, międzyczasy, VDOT, statystyki) |
| `vendor.js` | Biblioteki: dekoder FIT Garmina i rozpakowywanie ZIP |

## Wdrożenie

1. Załóż na GitHubie nowe, publiczne repo `przebieg` i wrzuć do niego te trzy pliki (oraz ten README).
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
