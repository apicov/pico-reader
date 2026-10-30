import httpx
from playwright.sync_api import expect

from conftest import AI, WEB

# matched by prompt: the two requests are made at the same time
TRANSLATED = {"_match": "dictionary into Spanish", "language": "de", "lemma": "das Strahlenschutzgesetz", "part_of_speech": "sustantivo", "meaning": "ley de protección radiológica",
              "notes": ""}
DEFINED = {"_match": "monolingual dictionary in the WORD's own language", "language": "de", "lemma": "das Strahlenschutzgesetz", "part_of_speech": "Substantiv",
           "meaning": "Gesetz zum Schutz vor ionisierender Strahlung", "notes": ""}


def test_a_word_no_dictionary_has_is_translated_and_defined_by_the_ai(page):
    # no dictionary installed, no language picked: the AI answers twice, in the reader's language (es) and in
    # the word's own, which it tells (de)
    httpx.post(f"{AI}/script-json", json=[TRANSLATED, DEFINED]).raise_for_status()
    page.goto(f"{WEB}/#/dictionary")
    page.get_by_label("Word").fill("Strahlenschutzgesetzes")
    page.get_by_label("Word").press("Enter")
    block = lambda label: page.get_by_text(f"AI · {label} · not in your dictionaries").locator("xpath=ancestor::div[2]")
    expect(block("Español")).to_contain_text("ley de protección radiológica", timeout=15_000)
    expect(block("Deutsch")).to_contain_text("Gesetz zum Schutz vor ionisierender Strahlung")
    assert "w=Strahlenschutzgesetzes" in page.url


def test_the_toolbar_leads_to_it_and_the_old_address_to_the_translations_tab(page):
    page.goto(f"{WEB}/#/")
    page.get_by_label("Dictionary and translations").click()
    page.get_by_role("tab", name="Dictionary", selected=True).wait_for()
    page.goto(f"{WEB}/#/translations")
    page.get_by_role("tab", name="Translations", selected=True).wait_for()
    assert "tab=history" in page.url
