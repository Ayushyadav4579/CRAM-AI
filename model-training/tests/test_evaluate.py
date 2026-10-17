import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import evaluate

def test_mcq_parser_accepts_explicit_leading_key():
    assert evaluate.parsed_key("Answer: D. soft") == "D"
    assert evaluate.parsed_key("B. Carbon dioxide") == "B"
    assert evaluate.parsed_key("Correct option: A - Photosynthesis") == "A"

def test_mcq_parser_does_not_count_stray_letters_or_prose():
    assert evaluate.parsed_key("The answer is probably B because...") is None
    assert evaluate.parsed_key("Carbon dioxide is more available than other gases") is None
    assert evaluate.parsed_key('{"front":"question","back":"answer"}') is None

def test_token_f1_rewards_content_overlap_not_just_nonempty():
    assert evaluate.token_f1("carbon dioxide", "carbon dioxide") == 1.0
    assert evaluate.token_f1("carbon dioxide", "oxygen") == 0.0
