// ===================================
// Mobile Navigation Toggle
// ===================================
document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        });

        // Close menu when clicking on a link
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });
    }
});

// ===================================
// Matrix Rain Effect for Hero Section
// ===================================
function initMatrixRain() {
    const canvas = document.getElementById('matrix-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Matrix characters - coding themed
    const chars = '01';
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    
    // Array to store y-position of each column
    const drops = Array(Math.floor(columns)).fill(1);

    function draw() {
        // Semi-transparent black to create fade effect
        ctx.fillStyle = 'rgba(10, 14, 39, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#00ff88';
        ctx.font = fontSize + 'px monospace';

        for (let i = 0; i < drops.length; i++) {
            const text = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);

            // Reset drop to top randomly
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }

    setInterval(draw, 50);
}

// Initialize matrix effect on home page
if (document.getElementById('matrix-canvas')) {
    initMatrixRain();
}

// ===================================
// Smooth Scrolling for Scroll Indicator
// ===================================
const scrollIndicator = document.querySelector('.scroll-indicator');
if (scrollIndicator) {
    scrollIndicator.addEventListener('click', function() {
        window.scrollTo({
            top: window.innerHeight,
            behavior: 'smooth'
        });
    });
}

// ===================================
// Projects Filtering
// ===================================
const filterButtons = document.querySelectorAll('.filter-btn');
const projectCards = document.querySelectorAll('.project-card');

if (filterButtons.length > 0) {
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');

            const filter = this.dataset.filter;

            projectCards.forEach(card => {
                const category = card.dataset.category;
                
                if (filter === 'all') {
                    card.style.display = 'block';
                    card.classList.add('fade-in');
                } else {
                    if (category.includes(filter)) {
                        card.style.display = 'block';
                        card.classList.add('fade-in');
                    } else {
                        card.style.display = 'none';
                    }
                }
            });
        });
    });
}

// ===================================
// Intersection Observer for Fade-in Animations
// ===================================
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe all cards and sections
document.querySelectorAll('.overview-card, .project-card, .skill-category, .certificate-card, .contact-card').forEach(el => {
    observer.observe(el);
});

// ===================================
// Navbar Background on Scroll
// ===================================
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(10, 14, 39, 0.98)';
        navbar.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)';
    } else {
        navbar.style.background = 'rgba(10, 14, 39, 0.95)';
        navbar.style.boxShadow = 'none';
    }
});

// ===================================
// Typing Effect for Hero Text (Optional Enhancement)
// ===================================
function typeWriter(element, text, speed = 100) {
    let i = 0;
    element.textContent = '';
    
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Uncomment to enable typing effect on subtitle
// const subtitle = document.querySelector('.subtitle');
// if (subtitle) {
//     const originalText = subtitle.textContent;
//     typeWriter(subtitle, originalText, 80);
// }

// ===================================
// Active Page Highlighting
// ===================================
function setActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav-menu a');
    
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });
}

setActiveNav();

// ===================================
// Particle Background Effect (Alternative to Matrix)
// ===================================
class Particle {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.reset();
    }

    reset() {
        this.x = Math.random() * this.canvas.width;
        this.y = Math.random() * this.canvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > this.canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > this.canvas.height) this.vy *= -1;
    }

    draw() {
        this.ctx.beginPath();
        this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(0, 255, 136, 0.5)';
        this.ctx.fill();
    }
}

// Uncomment to use particle effect instead of matrix
// function initParticles() {
//     const canvas = document.getElementById('matrix-canvas');
//     if (!canvas) return;
    
//     const ctx = canvas.getContext('2d');
//     canvas.width = window.innerWidth;
//     canvas.height = window.innerHeight;
    
//     const particles = [];
//     const particleCount = 100;
    
//     for (let i = 0; i < particleCount; i++) {
//         particles.push(new Particle(canvas));
//     }
    
//     function animate() {
//         ctx.clearRect(0, 0, canvas.width, canvas.height);
        
//         particles.forEach(particle => {
//             particle.update();
//             particle.draw();
//         });
        
//         // Draw connections
//         for (let i = 0; i < particles.length; i++) {
//             for (let j = i + 1; j < particles.length; j++) {
//                 const dx = particles[i].x - particles[j].x;
//                 const dy = particles[i].y - particles[j].y;
//                 const distance = Math.sqrt(dx * dx + dy * dy);
                
//                 if (distance < 100) {
//                     ctx.beginPath();
//                     ctx.strokeStyle = `rgba(0, 255, 136, ${1 - distance / 100})`;
//                     ctx.lineWidth = 0.5;
//                     ctx.moveTo(particles[i].x, particles[i].y);
//                     ctx.lineTo(particles[j].x, particles[j].y);
//                     ctx.stroke();
//                 }
//             }
//         }
        
//         requestAnimationFrame(animate);
//     }
    
//     animate();
    
//     window.addEventListener('resize', () => {
//         canvas.width = window.innerWidth;
//         canvas.height = window.innerHeight;
//     });
// }

// ===================================
// Cursor Trail Effect (Optional)
// ===================================
class CursorTrail {
    constructor() {
        this.particles = [];
        this.maxParticles = 20;
        
        document.addEventListener('mousemove', (e) => {
            this.addParticle(e.clientX, e.clientY);
        });
        
        this.animate();
    }

    addParticle(x, y) {
        if (this.particles.length >= this.maxParticles) {
            this.particles.shift();
        }

        this.particles.push({
            x: x,
            y: y,
            life: 1
        });
    }

    animate() {
        // Remove old particles
        this.particles = this.particles.filter(p => p.life > 0);

        // Update particles
        this.particles.forEach(p => {
            p.life -= 0.02;
        });

        requestAnimationFrame(() => this.animate());
    }
}

// Uncomment to enable cursor trail
// const cursorTrail = new CursorTrail();

// ===================================
// Console Easter Egg
// ===================================
console.log('%cHallo! 👋', 'color: #00ff88; font-size: 24px; font-weight: bold;');
console.log('%cWenn du das siehst, bist du wohl technikaffin! 🚀', 'color: #0077ff; font-size: 16px;');
console.log('%cFühle dich frei, den Code zu erkunden!', 'color: #ffffff; font-size: 14px;');
console.log('%cGemacht mit ❤️ für Informatiker', 'color: #00ff88; font-size: 12px;');
