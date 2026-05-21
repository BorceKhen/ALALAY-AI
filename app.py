from flask import Flask, render_template, redirect, url_for

app = Flask(__name__)

@app.route('/')
def auth():
    # Renders authentication.html
    return render_template('authentication.html')

@app.route('/login', methods=['POST'])
def login():
    # Inside here is where you would validate credentials later!
    # For now, we just immediately redirect them home.
    return redirect(url_for('home'))

@app.route('/home')
def home():
    # Renders home.html inside the base layout
    return render_template('home.html')

@app.route('/decks')
def my_decks():
    # Renders my_decks.html inside the base layout
    return render_template('my_decks.html')

@app.route('/flashcard')
def flashcard():
    # Renders flashcard.html inside the base layout
    return render_template('flashcard.html')

@app.route('/quiz')
def quiz():
    # Renders quiz.html inside the base layout
    return render_template('quiz.html')

@app.route('/accessibility')
def accessibility():
    # Renders accessibility.html inside the base layout
    return render_template('accessibility.html')

@app.route('/profile')
def profile():
    # Renders profile.html inside the base layout
    return render_template('profile.html')



if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=5000)