Fast Basketball Website: Owner's Guide

There are two editing screens, and one rule that matters more than anything else in
this guide. The rule first.

The one rule: Save is free, Publish is not

Every screen has a Save button and a Publish button.

Save keeps your work on the server as a draft. It costs nothing, it is not visible to
visitors, and it waits for you, even if you close the browser and come back next week.
Save as often as you like.

Publish takes everything you have saved and puts it on the live site. The site rebuilds
itself, which takes a minute or two. You do not need to wait on the page.

Each Publish uses one of 20 rebuilds the hosting plan allows per month. Use all 20 and
the site cannot rebuild again until the month resets, so nothing new can go live in the
meantime. The editor shows a meter with the count. The habit that avoids trouble: make
all of your changes, Save as you go, look at the Preview, then Publish once.

If you press Publish with unsaved changes, it asks first. Only saved work goes live.

Screen one: the Content Admin, at yoursite.com/admin

Works on a phone or a computer. Type the password you were given. You stay logged in
for 12 hours.

Content tab. Every piece of text on the site, grouped by the section of the page it
sits in. Click into a box and type. Long passages get a bigger box automatically.

Two things on this tab are on purpose. The dollar amounts on the pricing card cannot
be typed over. They are locked to the prices Stripe actually charges, so the page and
the card reader can never disagree. To change a price, tell your developer, who changes
both in one go. The wording next to each amount, for example "or $550 paid monthly",
is yours to edit, but it has to keep saying the same number.

Photos tab. Each of the site's photos has a card. Choose a new file, fill in the alt
text box (one plain sentence saying what is in the photo, for search engines and
screen readers), and press Upload New Photo. The new photo is held with your draft and
goes live when you Publish. If the photo is the wrong shape for its spot, the site says
so in plain words; crop closer to what it asks for and try again.

"+ Add a New Resume Card" is the one exception: it goes live straight away and uses
one of the month's rebuilds by itself.

Leads tab. Three kinds of people show up here, newest first.

  Enrollment: a family who filled in the registration form. The row shows the plan,
  whether they are paying in full or monthly, the amount, the player's name and grade,
  the program, and a "notice by" date, which is the last day they can give written
  notice to stop before the term renews.

  A row that starts with PENDING PAYMENT is a family who completed the whole form and
  has not paid yet. That is not a mistake and it is not an enrollment: their spot is
  not reserved. If they never pay, the row turns to NO PAYMENT about a day later and
  you get an email about it, because a form filled in and abandoned is usually worth
  one text message. REPLACED means they started again in a new tab and paid there, so
  there is nothing to chase.

  A yellow TEST tag means it came from Stripe's test mode, not real money.

  Contact: someone who used the "Book Your Call" form. Name, email, phone, the area
  they are in, and their message. These used to go only to your inbox; now they land
  here too, so nothing is lost if an email goes astray. You still get the email, and
  you can reply to it directly to reach the parent.

  Playbook: someone who asked for a free playbook. Name, email, position, focus.

Type in the filter box to search, or use the dropdown to show one kind. Export CSV
downloads whatever is showing as a spreadsheet, with every answer from the
registration form in its own column.

Enrollment link. At the top of the Leads tab. Pick the plan and the payment option you
agreed on the call, add the parent's email if you have it, and press Copy. Paste that
link into your enrollment email. It never expires: the secure checkout page opens when
the parent clicks it, and they finish on Stripe, where they tick the terms box and type
their full name to agree, exactly as the agreement asks.

The other buttons. Preview opens a new tab showing the homepage exactly as your current
edits would look, without publishing. Download Backup saves everything as one file to
keep somewhere safe.

Screen two: the Editor, at yoursite.com/admin/editor.html

Same password. This one needs a computer; on a phone the panels do not fit and it says
so. The left side lists the pages and sections. The middle is the site itself. Click
any text on the page and type in place. Drag and resize the elements on the free-form
sections. Undo and Redo do what they say, and Revert Section puts a whole section back
the way it was when you opened it.

Photos panel: add a photo here, crop it, and it is ready to drop into any spot on the
site, the same way the Photos tab works. Site panel: the page title and description
that search engines show, and the Motion switches that turn the animations up, down,
or off.

Save and Publish here are the same two buttons as the other screen, with the same rule.

What happens when a parent enrolls

Two emails, not one, because there are two moments.

The first arrives the second they finish the registration form, before they have paid.
It has every answer they gave: the athlete, the parent, the program, the insurance
details. Nothing is owed at that point and their spot is not reserved, so treat it as a
heads-up rather than a booking.

The second arrives when Stripe confirms the money, and that one is the enrollment. It
has the full details plus a welcome email already written out for you to paste and send.
Fill in the two bracketed spots, the Zoom recording and the first session, and send it
from your own inbox so their YES reply lands with you. Stripe has already sent them the
receipt.

Nobody signs anything on our website. A family agrees on Stripe's checkout page, where
they tick the terms box and type their full name, exactly as your training agreement
asks for. Stripe keeps that with the payment, so if a family ever disputes it, the
record is on the payment itself in the Stripe dashboard.

If a monthly card payment fails, you get an email. The parent gets one from Stripe with
a link to update their card, so you do not need to chase them unless it keeps failing.

Refunds, card problems, and a parent's payment history live in the Stripe dashboard,
not in this panel.

If something goes wrong

If a save fails, the screen says exactly what failed and nothing publishes halfway. A
bad edit can only ever reach a draft, never the live site, until you press Publish. If
you forget the password, your developer resets it. If you are stuck, take a screenshot
of the message and send it over.
