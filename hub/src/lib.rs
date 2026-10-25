//! The Airlock hub: the laptop-side service the phone and the laptop app talk to.
//!
//! The phone reaches [`phone::router`] through Tailscale Serve. The laptop app
//! and the `airlock` command reach [`admin::router`] through a Unix socket only
//! your user can open; approvals and devices live only there.

pub mod admin;
pub mod answer;
pub mod ask;
pub mod attach;
pub mod attention;
pub mod background;
pub mod center;
pub mod claude;
pub mod client;
pub mod config;
pub mod edits;
pub mod events;
pub mod faceid;
pub mod files;
pub mod history;
pub mod hooks;
pub mod laptop_tabs;
pub mod phone;
pub mod ports;
pub mod preview;
pub mod procs;
pub mod projects;
pub mod push;
pub mod repos;
pub mod state;
pub mod store;
pub mod system;
pub mod tab;
pub mod terminal_api;
pub mod terminals;
pub mod token;
pub mod transcript;
pub mod units;
