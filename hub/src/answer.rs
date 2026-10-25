//! Answers a Claude Code permission prompt from the phone by typing into the
//! session's terminal, as you would. The hub never guesses: it reads the
//! prompt off the screen, finds the option you chose by its words, moves the
//! highlight to it and presses Enter. "Deny" presses Escape, which declines
//! the prompt. No prompt on screen means nothing is typed.

use anyhow::{Context, Result, bail};
use axum::body::Bytes;
use serde::Deserialize;
use tokio::process::Command;

use crate::{claude::Pane, laptop_tabs::LaptopTabs};

pub enum Reach<'a> {
    Pane(&'a Pane),
    Tab { id: u32, tabs: &'a LaptopTabs },
}

impl Reach<'_> {
    pub async fn answer(&self, choice: Choice) -> Result<()> {
        match self {
            Self::Pane(pane) => answer(pane, choice).await,
            Self::Tab { id, tabs } => {
                let screen = tabs.text(*id).context("Its tab has closed.")?;
                let Some(prompt) = read_prompt(&screen) else {
                    bail!("Its terminal isn't asking anything now.");
                };
                tabs.press(*id, &keys_for(&prompt, choice)?).await
            }
        }
    }

    /// The screen with its colours, and its width and height.
    pub async fn in_colour(&self) -> Result<(String, u32, u32)> {
        match self {
            Self::Pane(pane) => screen_in_colour(pane).await,
            Self::Tab { id, tabs } => tabs.in_colour(*id).context("Its tab has closed."),
        }
    }

    pub async fn type_into(&self, text: Option<&str>, key: Option<&str>) -> Result<()> {
        match self {
            Self::Pane(pane) => type_into(pane, text, key).await,
            Self::Tab { id, tabs } => match (text, key) {
                (Some(text), None) if !text.is_empty() => {
                    tabs.type_bytes(*id, Bytes::copy_from_slice(text.as_bytes()))
                        .await
                }
                (None, Some(key)) if KEYS.contains(&key) => tabs.press(*id, &[key]).await,
                _ => bail!("Send some text, or one of these keys: {}.", KEYS.join(", ")),
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Once,
    Always,
    Deny,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PromptOption {
    pub number: u32,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Prompt {
    pub question: String,
    pub options: Vec<PromptOption>,
    pub focused: usize,
}

fn strip_frame(line: &str) -> &str {
    line.trim()
        .trim_start_matches(['│', '┃', '|'])
        .trim_end_matches(['│', '┃', '|'])
        .trim()
}

/// `❯ 1. Yes` or `  2. No`: the option's number and words, and whether the
/// highlight is on it.
fn option_line(line: &str) -> Option<(bool, PromptOption)> {
    let line = strip_frame(line);
    let (focused, rest) = match line.strip_prefix('❯').or_else(|| line.strip_prefix('>')) {
        Some(rest) => (true, rest.trim_start()),
        None => (false, line),
    };
    let (number, text) = rest.split_once(". ")?;
    let number: u32 = number.parse().ok()?;
    Some((
        focused,
        PromptOption {
            number,
            text: text.trim().to_owned(),
        },
    ))
}

pub fn read_prompt(screen: &str) -> Option<Prompt> {
    let lines: Vec<&str> = screen.lines().collect();
    let start = lines
        .iter()
        .rposition(|line| strip_frame(line).starts_with("Do you want to"))?;
    let mut options = Vec::new();
    let mut focused = None;
    for line in &lines[start + 1..] {
        match option_line(line) {
            Some((is_focused, option)) if option.number as usize == options.len() + 1 => {
                if is_focused {
                    focused = Some(options.len());
                }
                options.push(option);
            }
            // Wrapped option text continues on the next line.
            None if !options.is_empty() && !strip_frame(line).is_empty() => {}
            _ => {
                if !options.is_empty() {
                    break;
                }
            }
        }
    }
    if options.len() < 2 {
        return None;
    }
    Some(Prompt {
        question: strip_frame(lines[start]).to_owned(),
        options,
        focused: focused.unwrap_or(0),
    })
}

pub fn keys_for(prompt: &Prompt, choice: Choice) -> Result<Vec<&'static str>> {
    if choice == Choice::Deny {
        return Ok(vec!["Escape"]);
    }
    let target = prompt
        .options
        .iter()
        .position(|option| match choice {
            Choice::Once => option.text == "Yes",
            // "Yes, and don't ask again for …", "Yes, and always allow access
            // to …", "Yes, allow all edits …"; never a switch of mode.
            Choice::Always => {
                option.text.starts_with("Yes, ") && !option.text.contains("switch to")
            }
            Choice::Deny => false,
        })
        .with_context(|| match choice {
            Choice::Always => {
                "This prompt has no \"always allow\" choice; answer it in the terminal."
            }
            _ => "This prompt has no plain \"Yes\"; answer it in the terminal.",
        })?;
    let (step, count) = if target >= prompt.focused {
        ("Down", target - prompt.focused)
    } else {
        ("Up", prompt.focused - target)
    };
    let mut keys = vec![step; count];
    keys.push("Enter");
    Ok(keys)
}

fn tmux(pane: &Pane) -> Command {
    let mut command = Command::new("tmux");
    command.arg("-S").arg(&pane.socket).env_remove("TMUX");
    command
}

pub async fn screen(pane: &Pane) -> Result<String> {
    let output = tmux(pane)
        .args(["capture-pane", "-p", "-t", &pane.pane])
        .output()
        .await
        .context("running tmux")?;
    if !output.status.success() {
        bail!("Its terminal is gone.");
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub async fn answer(pane: &Pane, choice: Choice) -> Result<()> {
    let screen = screen(pane).await?;
    let Some(prompt) = read_prompt(&screen) else {
        bail!("Its terminal isn't asking anything now.");
    };
    let keys = keys_for(&prompt, choice)?;
    let output = tmux(pane)
        .args(["send-keys", "-t", &pane.pane])
        .args(&keys)
        .output()
        .await
        .context("running tmux")?;
    if !output.status.success() {
        bail!(
            "Couldn't type into its terminal: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

const HISTORY_LINES: &str = "-300";

/// The screen with its history, and its width and height.
pub async fn screen_in_colour(pane: &Pane) -> Result<(String, u32, u32)> {
    let output = tmux(pane)
        .args([
            "capture-pane",
            "-p",
            "-e",
            "-S",
            HISTORY_LINES,
            "-t",
            &pane.pane,
        ])
        .output()
        .await
        .context("running tmux")?;
    if !output.status.success() {
        bail!("Its terminal is gone.");
    }
    let size = tmux(pane)
        .args([
            "display-message",
            "-p",
            "-t",
            &pane.pane,
            "#{pane_width} #{pane_height}",
        ])
        .output()
        .await
        .context("running tmux")?;
    let size = String::from_utf8_lossy(&size.stdout).into_owned();
    let mut numbers = size
        .split_whitespace()
        .map(|n| n.parse::<u32>().unwrap_or(80));
    Ok((
        String::from_utf8_lossy(&output.stdout).into_owned(),
        numbers.next().unwrap_or(80),
        numbers.next().unwrap_or(24),
    ))
}

/// Keys the phone may press in a session's pane by name.
pub const KEYS: [&str; 12] = [
    "Enter", "Escape", "Tab", "BTab", "Up", "Down", "Left", "Right", "BSpace", "C-c", "C-d",
    "Space",
];

pub async fn type_into(pane: &Pane, text: Option<&str>, key: Option<&str>) -> Result<()> {
    let mut command = tmux(pane);
    command.args(["send-keys", "-t", &pane.pane]);
    match (text, key) {
        (Some(text), None) if !text.is_empty() => {
            command.arg("-l").arg(text);
        }
        (None, Some(key)) if KEYS.contains(&key) => {
            command.arg(key);
        }
        _ => bail!("Send some text, or one of these keys: {}.", KEYS.join(", ")),
    }
    let output = command.output().await.context("running tmux")?;
    if !output.status.success() {
        bail!(
            "Couldn't type into its terminal: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub async fn pane_alive(pane: &Pane) -> bool {
    tmux(pane)
        .args(["display-message", "-p", "-t", &pane.pane, "#{pane_id}"])
        .output()
        .await
        .is_ok_and(|output| output.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOXED: &str = "\
 some earlier output
╭──────────────────────────────────────────────────────────╮
│ Bash command                                             │
│                                                          │
│   pnpm test docs-sources                                 │
│   Run the docs tests                                     │
│                                                          │
│ Do you want to proceed?                                  │
│ ❯ 1. Yes                                                 │
│   2. Yes, and don't ask again for pnpm test commands in  │
│   /home/me/Projects/app                                  │
│   3. No, and tell Claude what to do differently (esc)    │
╰──────────────────────────────────────────────────────────╯
";

    const PLAIN: &str = "\
 Bash command

   npm test
   Run the tests

 Do you want to proceed?
   1. Yes
 ❯ 2. Yes, and don't ask again for: npm test *
   3. Yes, and switch to auto mode
   4. No

 Esc to cancel · Tab to amend
";

    /// Claude Code 2.1.301's prompt, as captured from a real session.
    const CAPTURED: &str = "\
❯ Use the Bash tool to run exactly this command: mkdir airlock-probe-dir

● Creating airlock-probe-dir directory
  ⎿  $ mkdir airlock-probe-dir

────────────────────────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose \"switch to auto mode\"
 below
 Create airlock-probe-dir directory
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 mkdir airlock-probe-dir
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to
      /home/me/Projects/demo from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend
";

    #[test]
    fn a_real_prompt_is_read_and_answered() {
        let prompt = read_prompt(CAPTURED).expect("a prompt");
        assert_eq!(prompt.options.len(), 4);
        assert_eq!(prompt.focused, 0);
        assert_eq!(keys_for(&prompt, Choice::Once).unwrap(), ["Enter"]);
        // Always is the "always allow", never the switch to auto mode.
        assert_eq!(
            keys_for(&prompt, Choice::Always).unwrap(),
            ["Down", "Enter"]
        );
    }

    #[test]
    fn a_boxed_prompt_is_read() {
        let prompt = read_prompt(BOXED).expect("a prompt");
        assert_eq!(prompt.question, "Do you want to proceed?");
        assert_eq!(prompt.options.len(), 3);
        assert_eq!(prompt.focused, 0);
        assert_eq!(prompt.options[0].text, "Yes");
        assert!(prompt.options[2].text.starts_with("No"));
    }

    #[test]
    fn choices_become_moves_from_the_highlight() {
        let boxed = read_prompt(BOXED).unwrap();
        assert_eq!(keys_for(&boxed, Choice::Once).unwrap(), ["Enter"]);
        assert_eq!(keys_for(&boxed, Choice::Always).unwrap(), ["Down", "Enter"]);
        assert_eq!(keys_for(&boxed, Choice::Deny).unwrap(), ["Escape"]);

        let plain = read_prompt(PLAIN).unwrap();
        assert_eq!(plain.options.len(), 4);
        assert_eq!(plain.focused, 1);
        assert_eq!(keys_for(&plain, Choice::Once).unwrap(), ["Up", "Enter"]);
        assert_eq!(keys_for(&plain, Choice::Always).unwrap(), ["Enter"]);
    }

    #[test]
    fn no_prompt_means_nothing_to_type() {
        assert_eq!(read_prompt("$ ls\nCargo.toml\n$ "), None);
        assert_eq!(read_prompt("Do you want to proceed?\n(y/n)"), None);
    }

    #[test]
    fn a_prompt_without_the_choice_is_refused() {
        let prompt = read_prompt("Do you want to make this edit?\n❯ 1. Yes\n  2. No\n").unwrap();
        assert!(keys_for(&prompt, Choice::Always).is_err());
        assert_eq!(keys_for(&prompt, Choice::Once).unwrap(), ["Enter"]);
    }

    /// A stand-in for Claude's prompt: shows the question, then records
    /// every key it gets into the file named by its argument.
    const FAKE_PROMPT: &str = r#"stty -icanon min 1 time 0 -echo
printf 'Bash command\n\n  ls\n\nDo you want to proceed?\n'
printf '\342\235\257 1. Yes\n'
printf "  2. Yes, and don't ask again for: ls\n"
printf '  3. No\n'
timeout --foreground 10 cat > "$1"
"#;

    /// Generous: the shell loads your bashrc, and other tests run too.
    async fn wait_for<T>(what: &str, mut check: impl AsyncFnMut() -> Option<T>) -> T {
        for _ in 0..300 {
            if let Some(found) = check().await {
                return found;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("waited 15 seconds for {what}");
    }

    #[tokio::test]
    async fn answers_are_typed_into_the_pane() {
        let scratch = crate::terminals::testing::ScratchTmux::new();
        let script = scratch.dir().join("prompt.sh");
        std::fs::write(&script, FAKE_PROMPT).unwrap();
        for (choice, want) in [
            (Choice::Once, "\n"),
            (Choice::Always, "\x1b[B\n"),
            (Choice::Deny, "\x1b"),
        ] {
            let keys = scratch.dir().join(format!("{choice:?}.keys"));
            let id = scratch.tmux.create("prompt", scratch.dir()).await.unwrap();
            let line = format!("bash {} {}", script.display(), keys.display());
            scratch.tmux.type_line(id, &line).await.unwrap();
            let socket = scratch.tmux.socket_path().await.unwrap();
            let pane_id = std::process::Command::new("tmux")
                .args(["-L", scratch.tmux.socket(), "display-message", "-p", "-t"])
                .arg(format!("${id}"))
                .arg("#{pane_id}")
                .output()
                .unwrap();
            let pane = Pane {
                socket,
                pane: String::from_utf8_lossy(&pane_id.stdout).trim().to_owned(),
            };
            wait_for("the prompt", async || {
                read_prompt(&screen(&pane).await.ok()?)
            })
            .await;
            answer(&pane, choice).await.unwrap();
            let got = wait_for("the keys", async || {
                let got = std::fs::read(&keys).ok()?;
                (got.len() >= want.len()).then_some(got)
            })
            .await;
            assert_eq!(String::from_utf8_lossy(&got), want, "{choice:?}");
        }
    }

    #[tokio::test]
    async fn a_prompt_in_a_laptop_tab_is_answered_there() {
        use crate::laptop_tabs::ToTab;

        let tabs = LaptopTabs::default();
        let (id, mut typed) = tabs.open(1, 70, 20);
        let reach = Reach::Tab { id, tabs: &tabs };
        assert!(
            reach.answer(Choice::Once).await.is_err(),
            "nothing asked yet"
        );
        tabs.printed(id, Bytes::from(BOXED.replace('\n', "\r\n")));
        reach.answer(Choice::Always).await.unwrap();
        assert_eq!(
            typed.recv().await,
            Some(ToTab::Input(Bytes::from_static(b"\x1b[B\r")))
        );
        reach.type_into(None, Some("C-c")).await.unwrap();
        assert_eq!(
            typed.recv().await,
            Some(ToTab::Input(Bytes::from_static(b"\x03")))
        );
        let (shown, width, height) = reach.in_colour().await.unwrap();
        assert_eq!((width, height), (70, 20));
        assert!(shown.contains("Do you want to proceed?"));
        tabs.close(id);
        assert!(reach.answer(Choice::Once).await.is_err(), "closed");
    }

    #[tokio::test]
    async fn nothing_is_typed_when_no_prompt_shows() {
        let scratch = crate::terminals::testing::ScratchTmux::new();
        let id = scratch.tmux.create("quiet", scratch.dir()).await.unwrap();
        let socket = scratch.tmux.socket_path().await.unwrap();
        let output = std::process::Command::new("tmux")
            .args(["-L", scratch.tmux.socket(), "display-message", "-p", "-t"])
            .arg(format!("${id}"))
            .arg("#{pane_id}")
            .output()
            .unwrap();
        let pane = Pane {
            socket,
            pane: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        };
        assert!(pane_alive(&pane).await);
        let refused = answer(&pane, Choice::Once).await.unwrap_err();
        assert_eq!(
            refused.to_string(),
            "Its terminal isn't asking anything now."
        );
        assert_eq!(
            scratch.tmux.locate(&pane.pane).await.map(|(t, _)| t),
            Some(id)
        );
    }
}
