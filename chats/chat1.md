# Wisdom of the Crowd app

_Started 2026-10-13 12:17 UTC_

---

## User

Implement a very small but pretty application:

Wisdom of the Crowd
Everyone anonymously submits one number that is on top of their mind, about themselves (and an optional description of the number), like hours slept last night, mood on a likert scale, coffees so far today, or unread emails. Before the reveal, everyone guesses the group average. Then you show the real distribution next to the guess distribution. For a data team this one is quietly delightful: you get a real histogram, a real crowd-estimation effect (or a funny miss), and a natural “who’s the outlier?” moment. It also scales well, and you can run a different metric each week as a recurring ritual.

Also do a word cloud of the matters the group is pondering.

I can build you a live voting page. It would have a voting view for phones and laptops and a presenter view with the reveal chart, published as a page from here. 

Make it look like it came from IKEA.

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

I built **Wisdom of the Crowd.dc.html**. It's in a flat-pack Scandinavian style: birch-paper background, heavy sans type, cobalt and yellow, and numbered steps like an assembly manual. It doesn't use IKEA's logo or trademarked branding.

- **Vote view (phone or laptop):** three steps: your number, an optional description, then your guess at the group average. Once you submit, you see a "Tack!" confirmation. After the reveal, voting is closed.
- **Presenter view:** you can edit the question in place. Before the reveal it shows a live count of submissions; after it, the real average, the crowd's guess, how far off the guess was, the median, and a one-line verdict. Below that are two histograms side by side (real numbers vs. guesses) with average lines, a "who's the outlier?" card with a button to hide it from the chart, and the word cloud built from the descriptions.
- **Settings:** a demo crowd of 20 made-up entries (on by default) and the number of histogram bars.

One caveat: it isn't live across devices yet. Results only sync between browser tabs on the same machine. For real phone voting it needs a small shared backend; I can wire one up if you tell me what you'd like to host it on.

## User

Rename "WISDOM OF THE CROWD" to "Quantified SD&A". Hide Presenter mode, just make it available on semi-secret URL. "THIS WEEK'S QUESTION" to "Temperature check"

## Assistant

_[tool: dc_html_str_replace]_

_[tool: run_script]_

_[tool: ready_for_verification]_

I made all three changes: the header now reads "Quantified SD&A", the label is "Temperature check", and the Vote/Presenter switcher is gone from the header.

To open the presenter view, add `#backstage-7k2` to the end of the page URL. Anyone who knows that address can open it.

## User

Make it less focused on beeing Weekly, remove "Next week, a new number." and instead say "That's such a good number. Thank you, you'll do good in life!"

## Assistant

_[tool: dc_html_str_replace]_

_[tool: grep]_

I replaced "Next week, a new number." with your line. That was the last mention of "week" anywhere in the page.

