# herdr: the server runs detached from the terminal window (config/shell/herdr-attach). To undo, remove this file's `source` line
# from ~/.config/zsh/.zshrc. 2026-10-06.
herdr() { ~/.config/butler-code/config/shell/herdr-attach "$@" }

# No tmux inside a herdr pane (2026-10-06, the user's call). herdr is already the multiplexer: nesting tmux hides the agents
# from herdr (it sees `tmux` as the pane's process) and can make the screen flicker. This is a function, so it only stops
# an interactive `tmux` typed in a herdr pane: scripts, agents' tool shells and tests (which host a TUI with `tmux -d`) are not
# affected, and `command tmux ...` is the deliberate way around it.
if [[ "$HERDR_ENV" == 1 ]]; then
  tmux() {
    print -u2 "tmux 在 herdr 里不需要，也别套：herdr 本身就是多窗格工作区（拆分 ctrl+t 再按 v 或 -，新标签 ctrl+t c，离开 ctrl+t q）。套娃会让 herdr 认不出里面的 AI。确实要用，写 command tmux …"
    return 1
  }
fi
